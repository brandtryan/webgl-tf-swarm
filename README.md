# WebGL2 Transform Feedback Swarm

A high-performance GPGPU particle simulation using `@thi.ng/shader-ast` and WebGL2 Transform Feedback.

## Features

- **100,000 Particles** simulated entirely on the GPU.
- **60 FPS Performance** with minimal CPU overhead.
- **Dynamic Physics**:
  - Simplex Noise (3D) turbulence.
  - Interactive Mouse Attraction.
  - Center-repulsion to maintain swarm structure.
- **Custom Color Palette**: Velocity-based color mapping using a "Deep Teal / Neon Pink / Golden Yellow" palette.
- **Class-based Architecture**: Clean, refactored TypeScript implementation.

## Tech Stack

- [thi.ng/umbrella](https://thi-ng.at/): `shader-ast`, `shader-ast-glsl`, `shader-ast-stdlib`, `rstream`.
- [Vite](https://vitejs.dev/): Build tool and dev server.
- [TypeScript](https://www.typescriptlang.org/): Type-safe development.

## Getting Started

```bash
yarn install
yarn start
```

## How it Works

Unlike traditional simulations that compute positions on the CPU and send them to the GPU every frame, this project uses **WebGL2 Transform Feedback**. 

The "Physics Kernel" is written in TypeScript using `@thi.ng/shader-ast`. This AST is compiled to a GLSL Vertex Shader. During the `update` pass, the GPU runs this shader and writes the results directly back into a Vertex Buffer (VBO) without returning to the CPU. The next frame, that VBO is used as the input, creating a high-speed feedback loop.
