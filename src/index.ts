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
	normalize,
	program as progs,
	defn,
	ret,
	ifThen,
	input,
	output,
	uniform,
	gt,
	$x,
	$y,
	$xy,
	$w,
	$z,
} from "@thi.ng/shader-ast";
import { GLSLVersion, targetGLSL } from "@thi.ng/shader-ast-glsl";
import { snoise3 } from "@thi.ng/shader-ast-stdlib";
import { fromRAF } from "@thi.ng/rstream";

const NUM_PARTICLES = 100000;

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

	constructor() {
		this.canvas = <HTMLCanvasElement>document.getElementById("glcanvas");
		this.gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false })!;
		this.ui = document.getElementById("ui")!;

		if (!snoise3) {
			console.error("snoise3 is undefined!");
		}

		this.init();
	}

	init() {
		this.setupEvents();
		this.resize();

		const data = this.generateInitialData();
		const { vs, fs } = this.createShaders();
		
		console.log("VS:\n", vs);
		console.log("FS:\n", fs);

		this.program = this.createProgram(vs, fs);
		this.locs = {
			time: this.gl.getUniformLocation(this.program, "u_time"),
			mouse: this.gl.getUniformLocation(this.program, "u_mouse"),
		};

		this.setupBuffers(data);

		this.gl.enable(this.gl.BLEND);
		this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);

		this.start();
	}

	setupEvents() {
		window.onresize = () => this.resize();
		window.onmousemove = e => {
			this.mouse = [
				(e.clientX / this.canvas.width) * 2 - 1,
				(1 - e.clientY / this.canvas.height) * 2 - 1
			];
		};
	}

	resize() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
	}

	generateInitialData() {
		const data = new Float32Array(NUM_PARTICLES * 4);
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
		const u_time = uniform("float", "u_time");
		const u_mouse = uniform("vec2", "u_mouse");

		const vsProgram = progs([
			snoise3,
			a_state,
			v_state,
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

				// Built-ins can be accessed by their names in the output
				// or we can define them as outputs with specific names
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
					
					assign(dir, sub(u_mouse, pos)),
					assign(dist, length(dir)),
					assign(force, mul(normalize(dir), div(float(0.01), max(dist, float(0.05))))),

					assign(noiseCoords, vec3(mul(pos, float(1.5)), mul(u_time, float(0.2)))),
					assign(noise, vec2(snoise3(noiseCoords), snoise3(add(noiseCoords, float(100.0))))),

					assign(vel, mul(add(vel, mul(add(force, mul(noise, float(0.02))), dt)), float(0.98))),
					assign(pos, add(pos, mul(vel, dt))),

					// Boundary Wrap
					ifThen(gt(abs($x(pos)), float(1.0)), [assign($x(pos), mul($x(pos), float(-0.99)))]),
					ifThen(gt(abs($y(pos)), float(1.0)), [assign($y(pos), mul($y(pos), float(-0.99)))]),

					assign(v_state, vec4(pos, vel)),
					assign(gl_Position, vec4(pos, 0, 1)),
					assign(gl_PointSize, float(1.5)),
				];
			}),
		]);

		const vsRaw = glsl(vsProgram);
		// Remove the duplicate declarations of built-ins if they were generated
		const vs = vsRaw
			.replace("#version 300 es", "#version 300 es\nprecision highp float;")
			.replace(/out\s+vec4\s+gl_Position\s*;/g, "")
			.replace(/out\s+float\s+gl_PointSize\s*;/g, "");

		const fs = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { 
    fragColor = vec4(0.3, 0.7, 1.0, 0.3); 
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
			next: (t) => this.update(t)
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
		gl.drawArrays(gl.POINTS, 0, NUM_PARTICLES);
		gl.endTransformFeedback();
		gl.disable(gl.RASTERIZER_DISCARD);

		// Render to screen
		gl.bindVertexArray(null);
		gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.bindVertexArray(writeIdx === 0 ? this.vaoA : this.vaoB);
		gl.drawArrays(gl.POINTS, 0, NUM_PARTICLES);

		this.readIdx = writeIdx;

		this.updateUI(t);
	}

	updateUI(t: number) {
		this.frames++;
		if (t > this.lastTime + 1000) {
			this.ui.innerText = `FPS: ${this.frames} | PARTICLES: ${NUM_PARTICLES} | CPU: ~0%`;
			this.frames = 0;
			this.lastTime = t;
		}
	}
}

new SwarmApp();
