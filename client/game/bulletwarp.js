export function createBulletWarpPostFX({
  sourceCanvas, // offscreen 2D canvas containing the scene
  outputCanvas, // onscreen WebGL canvas
  maxPoints = 32,
}) {
  const gl = outputCanvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("WebGL not available");

  const VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

  const FS = `
precision mediump float;

uniform sampler2D u_scene;
uniform vec2 u_resolution;        // backing pixels
uniform int u_count;              // number of warp points
uniform vec2 u_points[${maxPoints}];
uniform float u_ampPx;
uniform float u_sigmaPx;
uniform bool u_xSwap;             // <--- NEW

varying vec2 v_uv;

void main() {
  // Flip Y because canvas vs WebGL coords
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);

  // If xSwap: mirror horizontally (right <-> left)
  if (u_xSwap) {
    uv.x = 1.0 - uv.x;
  }

  vec2 pPx = uv * u_resolution;

  vec2 disp = vec2(0.0);
  float sigma2 = u_sigmaPx * u_sigmaPx;

  for (int i = 0; i < ${maxPoints}; i++) {
    if (i >= u_count) break;

    vec2 b = u_points[i];
    vec2 r = pPx - b;
    float d2 = dot(r, r);
    float d = sqrt(d2) + 1e-6;

    float g = u_ampPx * exp(-d2 / sigma2);
    vec2 u = r / d;

    disp += u * g;
  }

  vec2 srcPx = pPx + disp;                 // inverse warp (approx)
  vec2 srcUv = clamp(srcPx / u_resolution, vec2(0.0), vec2(1.0));
  srcUv.y = 1.0 - srcUv.y;
  gl_FragColor = texture2D(u_scene, srcUv);
}
`;

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(msg);
    }
    return s;
  }

  function makeProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const msg = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(msg);
    }
    return p;
  }

  const prog = makeProgram(VS, FS);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]),
    gl.STATIC_DRAW
  );

  const a_pos = gl.getAttribLocation(prog, "a_pos");
  const u_scene = gl.getUniformLocation(prog, "u_scene");
  const u_resolution = gl.getUniformLocation(prog, "u_resolution");
  const u_count = gl.getUniformLocation(prog, "u_count");
  const u_points0 = gl.getUniformLocation(prog, "u_points[0]");
  const u_ampPx = gl.getUniformLocation(prog, "u_ampPx");
  const u_sigmaPx = gl.getUniformLocation(prog, "u_sigmaPx");
  const u_xSwap = gl.getUniformLocation(prog, "u_xSwap"); // <--- NEW

  const sceneTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const pointsFlat = new Float32Array(maxPoints * 2);

  function resizeToMatchSource() {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    if (outputCanvas.width !== w || outputCanvas.height !== h) {
      outputCanvas.width = w;
      outputCanvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  function render({ pointsPx, ampPx = 12, sigmaPx = 140, xSwap = false }) {
    resizeToMatchSource();

    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      sourceCanvas
    );

    const count = Math.min(maxPoints, pointsPx?.length ?? 0);
    for (let i = 0; i < count; i++) {
      pointsFlat[i * 2 + 0] = pointsPx[i][0];
      pointsFlat[i * 2 + 1] = pointsPx[i][1];
    }
    for (let i = count; i < maxPoints; i++) {
      pointsFlat[i * 2 + 0] = 0;
      pointsFlat[i * 2 + 1] = 0;
    }

    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(a_pos);
    gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(u_scene, 0);

    gl.uniform2f(u_resolution, outputCanvas.width, outputCanvas.height);
    gl.uniform1i(u_count, count);
    gl.uniform2fv(u_points0, pointsFlat);
    gl.uniform1f(u_ampPx, ampPx);
    gl.uniform1f(u_sigmaPx, sigmaPx);
    gl.uniform1i(u_xSwap, xSwap ? 1 : 0); // <--- NEW

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return { render, resize: resizeToMatchSource };
}
