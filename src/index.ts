import {
	assign,
	defMain,
	float,
	vec2,
	vec3,
	vec4,
	sym,
	mul,
	add,
	sub,
	div,
	abs,
	dot,
	length,
	max,
	mix,
	normalize,
	program as progs,
	defn,
	ret,
	ifThen,
	input,
	output,
	uniform,
	gt,
	lt,
	neg,
	$x,
	$y,
	$xy,
	$w,
	$z,
	clamp,
} from "@thi.ng/shader-ast";
import { GLSLVersion, targetGLSL } from "@thi.ng/shader-ast-glsl";
import { snoise3 } from "@thi.ng/shader-ast-stdlib";
import { fromRAF } from "@thi.ng/rstream";

class SwarmApp {
	canvas: HTMLCanvasElement;
	gl: WebGL2RenderingContext;
	ui: HTMLElement;
	program!: WebGLProgram;
	vaoA!: WebGLVertexArrayObject;
	vaoB!: WebGLVertexArrayObject;
	bufA!: WebGLBuffer;
	bufB!: WebGLBuffer;
	locs!: { time: WebGLUniformLocation | null; mouse: WebGLUniformLocation | null };
	readIdx = 0;
	mouse = [0, 0];
	frames = 0;
	lastTime = 0;
	private lastFrameTimestamp = 0;
	private NUM_PARTICLES: number = 100000;
	private rafSubscription: any;

	constructor() {
		this.canvas = <HTMLCanvasElement>document.getElementById("glcanvas");
		this.gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false })!;
		this.ui = document.getElementById("ui")!;
		(globalThis as any).app = this;

		if (!snoise3) {
			console.error("snoise3 is undefined!");
		}

		this.init();
	}

	async init() {
		this.setupEvents();
		this.resize();

		// Show a loading state in the UI if needed
		this.ui.innerText = `Generating ${this.NUM_PARTICLES.toLocaleString()} particles...`;

		// Heavy array generation to a background thread
		const data = await this.generateInitialDataWorker(this.NUM_PARTICLES);

		if (!this.program) {
			const { vs, fs } = this.createShaders();
			this.program = this.createProgram(vs, fs);
			this.locs = {
				time: this.gl.getUniformLocation(this.program, "u_time"),
				mouse: this.gl.getUniformLocation(this.program, "u_mouse"),
			};
		}

		this.setupBuffers(data);
		this.gl.enable(this.gl.BLEND);
		this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
		if (!this.rafSubscription) this.start();
	}

	// Reset!
	reset(newCount: number) {
		this.NUM_PARTICLES = newCount;

		// 1. sweep old GPU buffers
		if (this.bufA) this.gl.deleteBuffer(this.bufA);
		if (this.bufB) this.gl.deleteBuffer(this.bufB);
		if (this.vaoA) this.gl.deleteVertexArray(this.vaoA);
		if (this.vaoB) this.gl.deleteVertexArray(this.vaoB);

		// 2. Re-run init
		this.init();
	}

	generateInitialDataWorker(NUM_PARTICLES: number): Promise<Float32Array> {
		return new Promise(resolve => {
			const workerCode = `
            onmessage = function(e) {
                const num = e.data;
                const data = new Float32Array(num * 4);
                for (let i = 0; i < data.length; i += 4) {
                    data[i] = Math.random() * 2 - 1;
                    data[i + 1] = Math.random() * 2 - 1;
                    data[i + 2] = (Math.random() - 0.5) * 0.1;
                    data[i + 3] = (Math.random() - 0.5) * 0.1;
                }
                postMessage(data, [data.buffer]); // Transfer buffer for 0ms copy time
            };
        `;
			const blob = new Blob([workerCode], { type: "application/javascript" });
			const worker = new Worker(URL.createObjectURL(blob));

			worker.onmessage = e => {
				resolve(e.data);
				worker.terminate();
			};
			worker.postMessage(this.NUM_PARTICLES);
		});
	}

	setupEvents() {
		window.onresize = () => this.resize();
		window.onmousemove = e => {
			this.mouse = [(e.clientX / this.canvas.width) * 2 - 1, (1 - e.clientY / this.canvas.height) * 2 - 1];
		};
	}

	resize() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
	}

	generateInitialData() {
		const data = new Float32Array(this.NUM_PARTICLES * 4);
		for (let i = 0; i < data.length; i += 4) {
			data[i] = Math.random() * 2 - 1;
			data[i + 1] = Math.random() * 2 - 1;
			data[i + 2] = (Math.random() - 0.5) * 0.1;
			data[i + 3] = (Math.random() - 0.5) * 0.1;
		}
		return data;
	}

	createShaders() {
		const glsl = targetGLSL({ version: GLSLVersion.GLES_300 });

		const a_state = input("vec4", "a_state");
		const v_state = output("vec4", "v_state");
		const v_color = output("vec3", "v_color");
		const u_time = uniform("float", "u_time");
		const u_mouse = uniform("vec2", "u_mouse");

		const vsProgram = progs([
			snoise3,
			a_state,
			v_state,
			v_color,
			u_time,
			u_mouse,
			defMain(() => {
				const pos = sym(vec2(0, 0));
				const vel = sym(vec2(0, 0));
				const dt = sym(float(0.016));
				const dir = sym(vec2(0, 0));
				const dist = sym(float(0));
				const force = sym(vec2(0, 0));
				const noiseCoords = sym(vec3(0, 0, 0));
				const noise = sym(vec2(0, 0));

				const gl_Position = output("vec4", "gl_Position");
				const gl_PointSize = output("float", "gl_PointSize");

				return [
					pos,
					vel,
					dt,
					dir,
					dist,
					force,
					noiseCoords,
					noise,

					assign(pos, $xy(a_state)),
					assign(vel, vec2($z(a_state), $w(a_state))),

					// 1. Attraction to Mouse
					assign(dir, sub(u_mouse, pos)),
					assign(dist, length(dir)),
					assign(force, mul(normalize(dir), div(float(0.02), max(dist, float(0.1))))),

					// 2. Center Repulsion (Prevents collapsing into a line/point)
					assign(dir, pos), // vector from center
					assign(dist, length(dir)),
					assign(force, add(force, mul(normalize(dir), div(float(0.005), max(dist, float(0.05)))))),

					// 3. Noise Turbulence
					assign(noiseCoords, vec3(mul(pos, float(1.2)), mul(u_time, float(0.15)))),
					assign(noise, vec2(snoise3(noiseCoords), snoise3(add(noiseCoords, float(100.0))))),

					// Physics Update
					assign(vel, mul(add(vel, mul(add(force, mul(noise, float(0.03))), dt)), float(0.985))),
					assign(pos, add(pos, mul(vel, dt))),

					// Boundary Wrap
					ifThen(gt(abs($x(pos)), float(1.05)), [assign($x(pos), mul(neg($x(pos)), float(0.95)))]),
					ifThen(gt(abs($y(pos)), float(1.05)), [assign($y(pos), mul(neg($y(pos)), float(0.95)))]),

					// Output State
					assign(v_state, vec4(pos, vel)),

					// Color mapping from sampleColors.jpg
					// Palette: Deep Teal (0, 0.2, 0.3), Neon Pink (1, 0.1, 0.6), Golden Yellow (1, 0.9, 0)
					assign(
						v_color,
						mix(
							vec3(0.0, 0.2, 0.3), // Deep Teal
							mix(
								vec3(1.0, 0.1, 0.6), // Neon Pink
								vec3(1.0, 0.9, 0.0), // Golden Yellow
								clamp(sub(mul(length(vel), float(15.0)), float(0.5)), float(0.0), float(1.0)),
							),
							clamp(mul(length(vel), float(15.0)), float(0.0), float(1.0)),
						),
					),

					assign(gl_Position, vec4(pos, 0, 1)),
					assign(gl_PointSize, float(1.5)),
				];
			}),
		]);

		const vsRaw = glsl(vsProgram);
		const vs = vsRaw
			.replace("#version 300 es", "#version 300 es\nprecision highp float;")
			.replace(/out\s+vec4\s+gl_Position\s*;/g, "")
			.replace(/out\s+float\s+gl_PointSize\s*;/g, "");

		const fs = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 fragColor;
void main() { 
    fragColor = vec4(v_color, 0.4); 
}`;

		return { vs, fs };
	}

	createProgram(vsSource: string, fsSource: string) {
		const gl = this.gl;
		const compile = (type: number, src: string) => {
			const s = gl.createShader(type)!;
			gl.shaderSource(s, src);
			gl.compileShader(s);
			if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
				const log = gl.getShaderInfoLog(s);
				console.error("Shader Log:\n", log);
				console.error("Source:\n", src);
				throw new Error("Shader compile error");
			}
			return s;
		};

		const program = gl.createProgram()!;
		gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
		gl.transformFeedbackVaryings(program, ["v_state"], gl.INTERLEAVED_ATTRIBS);
		gl.linkProgram(program);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error(gl.getProgramInfoLog(program));
			throw new Error("Program link error");
		}

		return program;
	}

	setupBuffers(data: Float32Array) {
		const gl = this.gl;
		this.bufA = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.bufA);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);

		this.bufB = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.bufB);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);

		this.vaoA = gl.createVertexArray()!;
		gl.bindVertexArray(this.vaoA);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.bufA);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);

		this.vaoB = gl.createVertexArray()!;
		gl.bindVertexArray(this.vaoB);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.bufB);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);

		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}

	start() {
		fromRAF({ timestamp: true }).subscribe({
			next: t => this.update(t),
		});
	}

	update(t: number) {
		const gl = this.gl;
		const writeIdx = 1 - this.readIdx;

		gl.useProgram(this.program);
		gl.uniform1f(this.locs.time, t * 0.001);
		gl.uniform2f(this.locs.mouse, this.mouse[0], this.mouse[1]);

		// Transform Feedback
		gl.bindVertexArray(this.readIdx === 0 ? this.vaoA : this.vaoB);
		gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, writeIdx === 0 ? this.bufA : this.bufB);

		gl.enable(gl.RASTERIZER_DISCARD);
		gl.beginTransformFeedback(gl.POINTS);
		gl.drawArrays(gl.POINTS, 0, this.NUM_PARTICLES);
		gl.endTransformFeedback();
		gl.disable(gl.RASTERIZER_DISCARD);

		// Render to screen
		gl.bindVertexArray(null);
		gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.bindVertexArray(writeIdx === 0 ? this.vaoA : this.vaoB);
		gl.drawArrays(gl.POINTS, 0, this.NUM_PARTICLES);

		this.readIdx = writeIdx;

		this.updateUI(t);
	}

	updateUI(t: number) {
		const frameTime = t - this.lastFrameTimestamp; // Current frame latency
		this.lastFrameTimestamp = t;

		this.frames++;
		if (t > this.lastTime + 1000) {
			// We show the latency of the very last frame for accuracy
			const latency = frameTime.toFixed(2);
			this.ui.innerText = `FPS: ${this.frames} | LATENCY: ${latency}ms | PARTICLES: ${this.NUM_PARTICLES.toLocaleString()}`;

			this.frames = 0;
			this.lastTime = t;
		}
	}
}

new SwarmApp();
