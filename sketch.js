// BISTABLE FINAL: black interface, hidden selfie feed, warm/cool light trails.
// TWO HANDS: upward/downward convergence selects mountain direction; distance controls strength.
// ONE FIST: vertical displacement controls local hill/valley, palm release -> neutral.
// Preview operates even when BLE is disconnected.
let handPose,video,hands=[],resetButton;
const N=16,NEUTRAL=90,MIN=5,MAX=180;
const channelForServo=[0,1,8,9,2,3,10,11,4,5,12,13,6,7,14,15];
const mountainUp=[110,126,119,103,135,166,151,114,124,180,159,108,105,132,121,99];
const mountainDown=[70,55,63,76,47,17,31,66,58,5,24,72,79,51,61,83];
let desired=Array(N).fill(90),actual=Array(N).fill(90),tracks=[],lastSend=0;
let mode='IDLE',mountainSign=1,lastTwo=null,referenceSeparation=null,grab=null,lastGestureTime=0;
const MOVE_SMOOTH=0.28,RELEASE_SMOOTH=0.13,SEND_INTERVAL=90;
const FIST_THRESHOLD=0.63;
const pts=Array.from({length:16},(_,i)=>({n:i+1,x:(i%4)*1.0+(Math.floor(i/4)%2?0.42:0),y:Math.floor(i/4)*0.92}));
const minX=0,maxX=3.42,minY=0,maxY=2.76;
async function setup(){createCanvas(windowWidth,windowHeight);pixelDensity(1);bleSetup();resetButton=createButton('RESET');resetButton.id('resetButton');resetButton.mousePressed(resetScene);const status=createDiv('Waiting for camera');status.id('status');try { handPose=await ml5.handPose(); video=createCapture({video:{facingMode:'user'},audio:false}); video.size(640,480); video.hide(); handPose.detectStart(video,r=>hands=r); status.html('Camera tracking active'); } catch(e) { console.error('HandPose startup:',e); status.html('Camera failed: '+e.message); }}
function kp(hand,i){return hand.keypoints&&hand.keypoints[i];}
function handScreenPoint(hand,i){const p=kp(hand,i);return p?{x:width*(1-p.x/640),y:height*p.y/480}:null;}
function center(hand){const ids=[0,5,9,13,17],v=ids.map(i=>handScreenPoint(hand,i)).filter(Boolean);return v.length?{x:v.reduce((s,p)=>s+p.x,0)/v.length,y:v.reduce((s,p)=>s+p.y,0)/v.length}:null;}
function fistScore(hand){const wrist=kp(hand,0);if(!wrist)return 0;let closed=0;for(const [tip,base] of [[8,5],[12,9],[16,13],[20,17]]){const a=kp(hand,tip),b=kp(hand,base);if(!a||!b)continue;const dt=Math.hypot(a.x-wrist.x,a.y-wrist.y),db=Math.hypot(b.x-wrist.x,b.y-wrist.y);if(dt<db*1.45)closed++;}return closed/4;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function handDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function resetScene(){desired.fill(90);actual.fill(90);mode='IDLE';grab=null;lastTwo=null;referenceSeparation=null;tracks=[];sendResetCommand();}
function updateGestures(){const detected=hands.map(h=>({h,p:center(h),closed:fistScore(h)})).filter(o=>o.p);if(detected.length>=2){grab=null;const a=detected[0].p,b=detected[1].p,sep=handDistance(a,b)/Math.max(width,height);const avgY=(a.y+b.y)/2/height;const bothClosed=detected[0].closed>=FIST_THRESHOLD&&detected[1].closed>=FIST_THRESHOLD;
// Determine sign from vertical direction of convergence; retain it while hands hold or separate.
if(!lastTwo){lastTwo={sep,avgY};referenceSeparation=sep;mode='TWO_HANDS';}
const dSep=sep-lastTwo.sep,dY=avgY-lastTwo.avgY;
if(dSep<-.004&&Math.abs(dY)>.002){mountainSign=dY<0?1:-1;}
// A new outward position can be the neutral reference, allowing the full height range.
referenceSeparation=Math.max(referenceSeparation||sep,sep);
const intensity=clamp((referenceSeparation-sep)/0.38,0,1);
for(let i=0;i<N;i++){const maxAngle=mountainSign===1?mountainUp[i]:mountainDown[i];desired[i]=90+(maxAngle-90)*intensity;}
lastTwo={sep,avgY};mode=mountainSign===1?'MOUNTAIN UP':'MOUNTAIN DOWN';lastGestureTime=millis();return;}
lastTwo=null;referenceSeparation=null;
if(detected.length===1&&detected[0].closed>=FIST_THRESHOLD){const p=detected[0].p;if(!grab){const nx=clamp(p.x/width,0,1)*(maxX-minX)+minX,ny=clamp(p.y/height,0,1)*(maxY-minY)+minY;let index=0,dist=Infinity;for(let i=0;i<N;i++){const d=Math.hypot(pts[i].x-nx,pts[i].y-ny);if(d<dist){dist=d;index=i;}}grab={index,startY:p.y,startAngle:actual[index]};}
const displacement=clamp((grab.startY-p.y)/Math.max(height*.33,1),-1,1);const target=clamp(grab.startAngle+(displacement>=0?90:85)*displacement,MIN,MAX);const base=pts[grab.index];for(let i=0;i<N;i++){const d=Math.hypot(pts[i].x-base.x,pts[i].y-base.y);const influence=Math.exp(-1.7*d*d);desired[i]=90+(target-90)*influence;}mode='LOCAL PULL';lastGestureTime=millis();return;}
// Open palm, no hands, or insufficient confidence: release to neutral.
grab=null;desired.fill(90);mode='RELEASE';}
function draw(){background(0);updateGestures();const ease=mode==='RELEASE'?RELEASE_SMOOTH:MOVE_SMOOTH;for(let i=0;i<N;i++)actual[i]+=(desired[i]-actual[i])*ease;
// Neon trails: glowing multi-stroke paths, fading with age.
const now=millis();const detected=hands.map(h=>({p:center(h)})).filter(o=>o.p);for(let i=0;i<detected.length;i++){const p=detected[i].p;const prev=tracks[i]&&tracks[i].length?tracks[i][tracks[i].length-1]:null;const dy=prev?p.y-prev.y:0;const color=mode==='MOUNTAIN DOWN'||(mode==='LOCAL PULL'&&desired.some(a=>a<85))||(dy>2)?'cool':'warm';if(!tracks[i])tracks[i]=[];tracks[i].push({x:p.x,y:p.y,t:now,color});}
for(let i=0;i<tracks.length;i++){tracks[i]=tracks[i].filter(p=>now-p.t<850);const path=tracks[i];for(let j=1;j<path.length;j++){const a=path[j-1],b=path[j],alpha=255*(1-(now-b.t)/850);const rgb=b.color==='warm'?[255,100+Math.floor(j%3)*35,95+Math.floor(j%4)*30]:[45,165+Math.floor(j%3)*25,255];stroke(rgb[0],rgb[1],rgb[2],alpha*.13);strokeWeight(24);line(a.x,a.y,b.x,b.y);stroke(rgb[0],rgb[1],rgb[2],alpha*.32);strokeWeight(11);line(a.x,a.y,b.x,b.y);stroke(rgb[0],rgb[1],rgb[2],alpha);strokeWeight(3);line(a.x,a.y,b.x,b.y);}}
noStroke();textAlign(CENTER,CENTER);textSize(15);fill(245);text(mode,width/2,35);
drawGrid();if(bleConnected&&now-lastSend>=SEND_INTERVAL){const byChannel=Array(16).fill(90);for(let i=0;i<16;i++)byChannel[channelForServo[i]]=Math.round(actual[i]);sendAngles(byChannel);lastSend=now;}}
function drawGrid(){const diameter=Math.min(width/15,height/11,42);const spacing=diameter*1.15;const startX=width/2-3*spacing;const startY=height/2-2.5*spacing;for(let r=0;r<6;r++)for(let c=0;c<6;c++){const x=startX+c*spacing+(r%2?spacing*.40:0),y=startY+r*spacing;const active=r>=1&&r<=4&&c>=1&&c<=4;stroke(active?color(100,210,210,140):color(120,120,120,85));strokeWeight(1);fill(active?color(10,60,65,110):color(100,100,100,65));circle(x,y,diameter);if(active){const n=(r-1)*4+c;noStroke();fill(240);textSize(Math.max(10,diameter*.33));text(n,x,y-diameter*.14);textSize(Math.max(8,diameter*.22));text(Math.round(actual[n-1])+'°',x,y+diameter*.19);}}}
function windowResized(){resizeCanvas(windowWidth,windowHeight);}
