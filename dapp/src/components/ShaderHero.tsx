import { useEffect, useRef } from "react";

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;
uniform float u_time;

// Simplex 2D noise (Ashima Arts)
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m;
  m = m*m;
  vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x_) - 0.5;
  vec3 ox = floor(x_ + 0.5);
  vec3 a0 = x_ - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = v_uv;
  float t = u_time * 0.15;

  // 3 noise layers at different scales/speeds
  float n1 = snoise(uv * 2.0 + vec2(t * 0.7, t * 0.3)) * 0.5 + 0.5;
  float n2 = snoise(uv * 4.0 + vec2(-t * 0.5, t * 0.8)) * 0.5 + 0.5;
  float n3 = snoise(uv * 1.2 + vec2(t * 0.2, -t * 0.4)) * 0.5 + 0.5;

  float combined = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

  // DarwinFi palette: teal (#00F0C0) + purple (#8040DD) over dark bg (#0B0B1A)
  vec3 teal = vec3(0.0, 0.94, 0.75);
  vec3 purple = vec3(0.5, 0.25, 0.87);
  vec3 bg = vec3(0.043, 0.043, 0.102);

  // Mix teal and purple based on noise
  vec3 color = mix(teal, purple, n2);

  // Darken significantly (25% intensity) - subtle ambient
  color = mix(bg, color, combined * 0.25);

  // Vignette
  vec2 vig = uv * (1.0 - uv);
  float vigFactor = vig.x * vig.y * 15.0;
  vigFactor = clamp(pow(vigFactor, 0.4), 0.0, 1.0);
  color *= vigFactor;

  fragColor = vec4(color, 1.0);
}`;

export function ShaderHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) return; // Graceful degradation

    // Compile shaders
    function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    gl.useProgram(program);

    // Fullscreen quad
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "u_time");

    const startTime = performance.now();

    function render() {
      const elapsed = (performance.now() - startTime) / 1000;
      gl!.uniform1f(uTime, elapsed);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
      animRef.current = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animRef.current);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: "16 / 5", minHeight: "140px" }}>
      {/* WebGL Canvas */}
      <canvas
        ref={canvasRef}
        width={320}
        height={180}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: "auto" }}
      />

      {/* Overlay content */}
      <div className="absolute inset-0 flex items-center justify-between px-10 md:px-14 lg:px-16">
        {/* Left: text */}
        <div className="relative z-10 max-w-lg">
          <h1 className="font-serif text-xl md:text-2xl lg:text-3xl font-bold text-darwin-text-bright mb-2 tracking-tight">
            Autonomous DeFi Vault
          </h1>
          <p className="font-sans text-sm md:text-base text-darwin-text/80">
            AI-managed trading strategies competing for your yield on Base L2
          </p>
        </div>

        {/* Right: logo (desktop) */}
        <div className="hidden lg:block relative z-10">
          <img
            src="/darwinfi/darwinfi-logo-bg.png"
            alt=""
            className="h-32 w-auto opacity-70 rounded-xl"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-darwin-bg to-transparent" />
    </div>
  );
}
