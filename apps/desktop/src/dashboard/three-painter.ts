import { NETWORK_LIMITS } from "@ink-writer/core";
import type { InkFrame, InkPainter } from "./ink-network";

/**
 * Paints the ink with three.js: one shader over the whole canvas (DESIGN.md). three.js is loaded
 * here and only here, when the Dashboard asks for it, so writing never carries it (ADR 0007).
 */

/** Gives what paints the network, or null if this machine can't: then there's no network. */
export type PainterLoader = (
  canvas: HTMLCanvasElement,
  /** Called if painting stops working later on, as when the system takes the graphics away. */
  onLost: () => void,
) => Promise<InkPainter | null>;

const VERTEX = "void main(){gl_Position=vec4(position.xy,0.,1.);}";

// Each node is a blot and each link a stroke, added up and bent by slow noise so that it reads as
// ink in water. The cost grows with every node and link, which is why they're limited.
const FRAGMENT = `
precision highp float;
#define MAX_N ${NETWORK_LIMITS.nodes}
#define MAX_E ${NETWORK_LIMITS.links}
uniform vec2 uRes; uniform float uTime; uniform int uNn; uniform int uEn;
uniform vec4 uN[MAX_N]; uniform vec3 uC[MAX_N];
uniform vec4 uE[MAX_E]; uniform vec3 uP[MAX_E];
uniform vec4 uFade; uniform vec3 uFlood; uniform float uW;
const vec3 PAPER=vec3(.965,.965,.949);
const vec3 INK=vec3(.071,.078,.11);
float hash(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+34.23);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(11.3,7.1);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  float t=uTime;
  vec2 w1=vec2(fbm(p*3.1+vec2(0.,t*.035)),fbm(p*3.1+vec2(5.2,1.3-t*.03)));
  vec2 q=p+(w1-.47)*.085;
  vec2 q2=p+(vec2(fbm(q*7.+t*.02),fbm(q*7.+vec2(3.1,8.4)-t*.02))-.47)*.035+(w1-.47)*.13;
  float core=0.,halo=0.; vec3 pig=vec3(0.);
  for(int i=0;i<MAX_N;i++){
    if(i>=uNn)break;
    vec2 d=q2-uN[i].xy; float r=max(uN[i].z,.0001); float k=uN[i].w;
    float g=k*exp(-dot(d,d)/(r*r));
    vec2 d2=q-uN[i].xy; float R=r*3.4;
    float h=k*exp(-dot(d2,d2)/(R*R));
    core+=g; halo+=h; pig+=uC[i]*(g*1.6+h*.5);
  }
  for(int i=0;i<MAX_E;i++){
    if(i>=uEn)break;
    vec2 a=uE[i].xy,b=uE[i].zw; vec2 pa=q-a,ba=b-a;
    float gr=uP[i].x; if(gr<=.001)continue;
    float s=clamp(dot(pa,ba)/max(dot(ba,ba),.000001),0.,gr);
    float dd=length(pa-ba*s);
    float wob=noise(vec2(s*7.+uP[i].z,uP[i].z*3.));
    float wd=(.0026+.0052*wob)*max(uP[i].y,.05)*uW;
    float tip=smoothstep(0.,.06,gr-s+.03);
    float g=uP[i].y*exp(-dd*dd/(wd*wd))*tip*(.5+.5*wob);
    float h=.2*uP[i].y*exp(-dd*dd/(wd*wd*34.))*tip;
    core+=g; halo+=h; pig+=INK*(g*1.6+h*.5);
  }
  float total=core*1.6+halo*.5;
  vec3 colr=total>.0005?pig/total:INK;
  float cloud=fbm(q*5.5+t*.015);
  float wash=(1.-exp(-halo*1.1))*(.25+.75*smoothstep(.33,.72,cloud))*.42;
  float body=smoothstep(.1,1.05,1.-exp(-core*2.1));
  float tide=smoothstep(.09,0.,abs(body-.3))*.12*step(.0,body);
  float a=clamp(wash+body+tide,0.,1.);
  a*=.93+.07*noise(gl_FragCoord.xy*.55);
  a*=smoothstep(uFade.x,uFade.y,uv.x)*smoothstep(uFade.z,uFade.w,1.-uv.y)*smoothstep(0.,.13,uv.y);
  vec3 c=mix(PAPER,colr,a);
  if(uFlood.z>0.){
    float fl=smoothstep(uFlood.z,uFlood.z-.14,length(q2-uFlood.xy));
    c=mix(c,INK,fl);
  }
  gl_FragColor=vec4(c,1.);
}`;

/** Whether this WebView can draw with WebGL at all, found out without loading three.js. */
export function supportsWebGl(): boolean {
  try {
    const context = document.createElement("canvas").getContext("webgl2");
    if (context == null) {
      return false;
    }
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export const loadThreePainter: PainterLoader = async (canvas, onLost) => {
  if (!supportsWebGl()) {
    return null;
  }
  try {
    const {
      Mesh,
      OrthographicCamera,
      PlaneGeometry,
      Scene,
      ShaderMaterial,
      Vector2,
      Vector3,
      Vector4,
      WebGLRenderer,
    } = await import("three");

    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    let broken = false;
    renderer.debug.onShaderError = () => {
      broken = true;
    };
    const uniforms = {
      uRes: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uNn: { value: 0 },
      uEn: { value: 0 },
      uN: { value: Array.from({ length: NETWORK_LIMITS.nodes }, () => new Vector4()) },
      uC: { value: Array.from({ length: NETWORK_LIMITS.nodes }, () => new Vector3()) },
      uE: { value: Array.from({ length: NETWORK_LIMITS.links }, () => new Vector4()) },
      uP: { value: Array.from({ length: NETWORK_LIMITS.links }, () => new Vector3()) },
      uFade: { value: new Vector4(0, 0, 0, 0) },
      uFlood: { value: new Vector3() },
      uW: { value: 1 },
    };
    const geometry = new PlaneGeometry(2, 2);
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(geometry, material);
    quad.frustumCulled = false;
    const scene = new Scene();
    scene.add(quad);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    let told = false;
    const lost = () => {
      if (!told) {
        told = true;
        onLost();
      }
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      lost();
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    return {
      resize(width, height, pixelRatio) {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
        renderer.getDrawingBufferSize(uniforms.uRes.value);
      },
      paint(frame: InkFrame) {
        const nodes = frame.nodes.slice(0, NETWORK_LIMITS.nodes);
        const links = frame.links.slice(0, NETWORK_LIMITS.links);
        nodes.forEach((node, index) => {
          uniforms.uN.value[index]?.set(node.x, node.y, node.radius, node.ink);
          uniforms.uC.value[index]?.set(...node.color);
        });
        links.forEach((link, index) => {
          uniforms.uE.value[index]?.set(link.ax, link.ay, link.bx, link.by);
          uniforms.uP.value[index]?.set(link.grow, link.ink, link.seed);
        });
        uniforms.uNn.value = nodes.length;
        uniforms.uEn.value = links.length;
        uniforms.uTime.value = frame.time;
        uniforms.uFade.value.set(...frame.fade);
        uniforms.uFlood.value.set(frame.flood.x, frame.flood.y, frame.flood.reach);
        uniforms.uW.value = frame.stroke;
        renderer.render(scene, camera);
        if (broken) {
          lost();
        }
      },
      dispose() {
        canvas.removeEventListener("webglcontextlost", onContextLost);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      },
    };
  } catch {
    return null;
  }
};
