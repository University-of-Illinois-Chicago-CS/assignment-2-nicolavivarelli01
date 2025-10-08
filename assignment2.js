import vertexShaderSrc from './vertex.glsl.js';
import fragmentShaderSrc from './fragment.glsl.js'

var gl = null;
var vao = null;
var program = null;
var vertexCount = 0;
var uniformModelViewLoc = null;
var uniformProjectionLoc = null;
var heightmapData = null;
let dragRotY = 0;  
let dragRotZ = 0;   
let panX = 0, panY = 0, panZ = 0;
let vaoWire = null;
let vertexCountWire = 0;
let posLoc = -1;

function processImage(img)
{
	var off = document.createElement('canvas');
	
	var sw = img.width, sh = img.height;
	off.width = sw; off.height = sh;
	
	var ctx = off.getContext('2d');
	ctx.drawImage(img, 0, 0, sw, sh);
	
	var imgd = ctx.getImageData(0,0,sw,sh);
	var px = imgd.data;
	
	var heightArray = new Float32Array(sw * sh);
	
	for (var y=0;y<sh;y++) 
	{
		for (var x=0;x<sw;x++) 
		{
			var i = (y*sw + x)*4;
			
			var r = px[i+0], g = px[i+1], b = px[i+2];
			
			var lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255.0;

			heightArray[y*sw + x] = lum;
		}
	}

	return {
		data: heightArray,
		width: sw,
		height: sh
	};
}

window.loadImageFile = function(event)
{
	var f = event.target.files && event.target.files[0];
	if (!f) return;
	
	var reader = new FileReader();
	reader.onload = function() 
	{
		var img = new Image();
		img.onload = function() 
		{
			heightmapData = processImage(img);
	
			console.log('loaded image: ' + heightmapData.width + ' x ' + heightmapData.height);
			const positions = buildMeshFromHeightmap(heightmapData);
			uploadMesh(positions);
		};
		img.onerror = function() 
		{
			console.error("Invalid image file.");
			alert("The selected file could not be loaded as an image.");
		};

		img.src = reader.result;
	};
	reader.readAsDataURL(f);
}

function setupViewMatrix(eye, target)
{
    var forward = normalize(subtract(target, eye));
    var upHint  = [0, 1, 0];

    var right = normalize(cross(forward, upHint));
    var up    = cross(right, forward);

    var view = lookAt(eye, target, up);
    return view;
}

function getRotationRad() {
  const s = document.getElementById('rotation');
  return s ? (Number(s.value) * Math.PI / 180) : 0;
}
function getHeightScale() {
  const s = document.getElementById('height');
  return s ? (Number(s.value) / 50) : 1.0; 
}

function getProjMode() {
  const sel = document.getElementById('projectionSelect');
  return sel ? sel.value : 'perspective';
}

function getZoomFactor() {
  const s = document.getElementById('scale');
  const v = s ? Number(s.value) : 60;    
  return 0.6 + (200 - v) / 100; 
}

function getCameraDist() {
  const s = document.getElementById('scale');
  const v = s ? Number(s.value) : 120;  
  const t = Math.min(1, Math.max(0, v / 200)); 
  return 6.0 * (1 - t) + 1.8 * t;
}

function isWireframe() {
  const cb = document.getElementById('wireframe');
  return !!(cb && cb.checked);
}

function draw() {
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0.2, 0.2, 0.2, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const aspect = gl.canvas.width / gl.canvas.height;
  const mode = getProjMode();
  let projectionMatrix;
  let eye;
  
  if (mode === 'orthographic') {
    const zoom = getZoomFactor();     
    const base = 1.2;                  
    const size = base / zoom;
    const left = -size * aspect, right = size * aspect, bottom = -size, top = size;
    projectionMatrix = orthographicMatrix(left, right, bottom, top, 0.001, 50.0);
    eye = [0, 3.0, 3.0];              
  } else {
    const fov = 70 * Math.PI / 180;
    projectionMatrix = perspectiveMatrix(fov, aspect, 0.001, 50.0);
    const dist = getCameraDist();     
    eye = [0, 3.0, dist];
  }

  const target = [0, 0, 0];
  const viewMatrix = setupViewMatrix(eye, target);

  const sliderY = getRotationRad();
  const hS = getHeightScale();

  const rotY = sliderY + dragRotY;
  const rotZ = dragRotZ;

  const modelMatrix = multiplyArrayOfMatrices([
    translateMatrix(panX, panY, panZ),
    rotateYMatrix(rotY),
    rotateZMatrix(rotZ),
    scaleMatrix(1, hS, 1),
  ]);
  const modelviewMatrix = multiplyMatrices(viewMatrix, modelMatrix);

  gl.useProgram(program);
  gl.uniformMatrix4fv(uniformModelViewLoc, false, new Float32Array(modelviewMatrix));
  gl.uniformMatrix4fv(uniformProjectionLoc, false, new Float32Array(projectionMatrix));

  if (isWireframe()) {
    if (vaoWire && vertexCountWire > 0) {
      gl.bindVertexArray(vaoWire);
      gl.drawArrays(gl.LINES, 0, vertexCountWire);
    }
  } else {
    if (vao && vertexCount > 0) {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }
  }

  requestAnimationFrame(draw);
}

var isDragging = false;
var leftMouse = false;

function addMouseCallback(canvas)
{
	isDragging = false;
  let lastX = 0, lastY = 0; 

	canvas.addEventListener("mousedown", function (e) 
	{
		if (e.button === 0) {
			leftMouse = true;
		} else if (e.button === 2) {
			leftMouse = false;
		}
		isDragging = true;
    lastX = e.clientX;       
    lastY = e.clientY;       
	});

	canvas.addEventListener("contextmenu", function(e)  {
		e.preventDefault();
	});

	canvas.addEventListener("wheel", function(e)  {
	e.preventDefault();                 

	const slider = document.getElementById('scale');
	if (!slider) return;

	const step = 8;                   
	const dir  = (e.deltaY < 0) ? +step : -step;

	const v  = Number(slider.value);
	const nv = Math.max(0, Math.min(200, v + dir));
	slider.value = String(nv);
	}, { passive:false });

	document.addEventListener("mousemove", function (e) {
		if (!isDragging) return;

    const dx = e.clientX - lastX;  
    const dy = e.clientY - lastY;  
    lastX = e.clientX;             
    lastY = e.clientY;             

    if (leftMouse) {
      dragRotY += dx * 0.01;
      dragRotZ += dy * 0.01;
    } else {
      const dist = getCameraDist();              
      const k = 0.0016 * dist;                   
      if (e.shiftKey) {
        panX += dx * k;
        panY += -dy * k;                          
      } else {
        panX += dx * k;
        panZ += dy * k;                          
      }
    }
	});

	document.addEventListener("mouseup", function () {
		isDragging = false;
	});

	document.addEventListener("mouseleave", () => {
		isDragging = false;
	});
}

function buildMeshFromHeightmap(hm) {
  const w = hm.width, h = hm.height, d = hm.data;

  const nx = x => (x / (w - 1)) * 2 - 1;
  const nz = y => (y / (h - 1)) * 2 - 1;

  const cellsX = w - 1, cellsY = h - 1;
  const positions = new Float32Array(cellsX * cellsY * 6 * 3);

  let p = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const x0 = nx(x),     x1 = nx(x + 1);
      const z0 = nz(y),     z1 = nz(y + 1);

      const y00 = d[y * w + x];
      const y10 = d[y * w + x + 1];
      const y01 = d[(y + 1) * w + x];
      const y11 = d[(y + 1) * w + x+1];

      positions[p++] = x0; positions[p++] = y00; positions[p++] = z0;
      positions[p++] = x1; positions[p++] = y10; positions[p++] = z0;
      positions[p++] = x0; positions[p++] = y01; positions[p++] = z1;

      positions[p++] = x1; positions[p++] = y10; positions[p++] = z0;
      positions[p++] = x1; positions[p++] = y11; positions[p++] = z1;
      positions[p++] = x0; positions[p++] = y01; positions[p++] = z1;
    }
  }
  return positions;
}

function uploadMesh(positions) {
  const posBuffer = createBuffer(gl, gl.ARRAY_BUFFER, positions);
  vao = createVAO(gl, posLoc, posBuffer, null, null, null, null);
  vertexCount = positions.length / 3;

  const linePositions = buildWireFromTriangles(positions);
  const lineBuf = createBuffer(gl, gl.ARRAY_BUFFER, linePositions);
  vaoWire = createVAO(gl, posLoc, lineBuf, null, null, null, null);
  vertexCountWire = linePositions.length / 3;
}

function initialize() {
  const canvas = document.querySelector("#glcanvas");
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  gl = canvas.getContext("webgl2");
  if (!gl) { alert("WebGL2 required"); return; }

  addMouseCallback(canvas);

  const vs = createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
  program = createProgram(gl, vs, fs);

  uniformModelViewLoc = gl.getUniformLocation(program, 'modelview');
  uniformProjectionLoc = gl.getUniformLocation(program, 'projection');
  posLoc = gl.getAttribLocation(program, 'position');

  vao = null;
  vertexCount = 0;

  window.requestAnimationFrame(draw);
}

function buildWireFromTriangles(triPositions) {
  const triCount = triPositions.length / 9;    
  const lines = new Float32Array(triCount * 6 * 3);

  let p = 0;
  for (let i = 0; i < triPositions.length; i += 9) {
    const x0 = triPositions[i],   y0 = triPositions[i+1], z0 = triPositions[i+2];
    const x1 = triPositions[i+3], y1 = triPositions[i+4], z1 = triPositions[i+5];
    const x2 = triPositions[i+6], y2 = triPositions[i+7], z2 = triPositions[i+8];

    lines[p++] = x0; lines[p++] = y0; lines[p++] = z0;
    lines[p++] = x1; lines[p++] = y1; lines[p++] = z1;

    lines[p++] = x1; lines[p++] = y1; lines[p++] = z1;
    lines[p++] = x2; lines[p++] = y2; lines[p++] = z2;

    lines[p++] = x2; lines[p++] = y2; lines[p++] = z2;
    lines[p++] = x0; lines[p++] = y0; lines[p++] = z0;
  }
  return lines;
}

window.addEventListener('load', initialize);
