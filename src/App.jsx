import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { saveUserData, subscribeToUserData } from './store';
import AuthScreen from './AuthScreen';

/* ═══ UTILS ═══ */
const QUOTES = [
  "The market will be here tomorrow. Will your capital?",
  "The best trade you'll ever make is the one you didn't chase.",
  "Slow is smooth. Smooth is fast.",
  "Missing a trade costs nothing. A bad trade costs everything.",
  "Consistency beats intensity. Every single time.",
  "Your edge isn't speed — it's patience.",
  "Compounding doesn't care about excitement. It cares about showing up.",
  "The move already happened. The next one hasn't. Wait for it.",
  "One bad revenge trade can erase a week of discipline.",
  "Losses are tuition. Revenge trades are dropping out.",
  "Small gains, repeated. That's the whole secret.",
  "The prediction market is still probability. Not certainty.",
];

function compoundArr(p,pct,d){const r=[p];for(let i=1;i<=d;i++)r.push(r[i-1]*(1+pct/100));return r;}
function fmt(n){const a=Math.abs(n),s=n<0?"-":"";if(a>=1e9)return`${s}$${(a/1e9).toFixed(2)}B`;if(a>=1e6)return`${s}$${(a/1e6).toFixed(2)}M`;if(a>=1e3)return`${s}$${(a/1e3).toFixed(1)}K`;return`${s}$${a.toFixed(2)}`;}
function fmtPct(n){if(Math.abs(n)>99999)return`${(n/1000).toFixed(0)}K%`;return(n>=0?"+":"")+n.toFixed(2)+"%";}
function dk(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function sd(iso){const[,m,d]=iso.split("-");return`${parseInt(m)}/${parseInt(d)}`;}
function neededPct(cur,goal,days){if(days<=0||cur<=0||goal<=cur)return 0;return(Math.pow(goal/cur,1/days)-1)*100;}

/* ═══ SHARED COMPONENTS ═══ */
function Sparkline({data,color}){if(!data||data.length<2)return null;const mx=Math.max(...data),mn=Math.min(...data),rg=mx-mn||1;const pts=data.map((v,i)=>`${(i/(data.length-1))*200},${50-((v-mn)/rg)*50}`);const id=`sg${color.replace("#","")}${Math.random().toString(36).slice(2,5)}`;return <svg viewBox="0 0 200 50" style={{width:"100%",height:50}}><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".3"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs><polygon points={`0,50 ${pts.join(" ")} 200,50`} fill={`url(#${id})`}/><polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;}

function GrowthChart({projData,realData,goalLine,hDay,maxDay,maxVal}){
  const cRef=useRef(null),dRef=useRef(null);
  useEffect(()=>{
    const canvas=cRef.current,container=dRef.current;if(!canvas||!container)return;
    const dpr=window.devicePixelRatio||1,rect=container.getBoundingClientRect();
    canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
    canvas.style.width=rect.width+"px";canvas.style.height=rect.height+"px";
    const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);
    const W=rect.width,H=rect.height,pad={t:20,r:20,b:40,l:65},pW=W-pad.l-pad.r,pH=H-pad.t-pad.b;
    ctx.clearRect(0,0,W,H);
    const hasReal=realData&&realData.length>1;

    // Determine visible range
    const visibleDays=maxDay||projData.length-1;
    const projSlice=projData.slice(0,visibleDays+1);
    const realSlice=hasReal?realData.slice(0,Math.min(realData.length,visibleDays+1)):[];

    const all=[...projSlice,...realSlice];
    if(goalLine>0)all.push(goalLine);
    let mx=Math.max(...all),mn=Math.min(...all);
    if(maxVal&&maxVal>0){mx=Math.min(mx,maxVal*1.15);} // add 15% headroom above cap
    const rg=mx-mn||1;
    const dispLen=visibleDays+1;
    const tX=i=>pad.l+(i/(dispLen-1))*pW;
    const tY=v=>pad.t+pH-((Math.min(v,mx)-mn)/rg)*pH;

    // Grid
    ctx.strokeStyle="rgba(255,255,255,.06)";ctx.lineWidth=1;
    for(let i=0;i<=4;i++){const y=pad.t+(pH/4)*i;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle="rgba(255,255,255,.35)";ctx.font="11px 'DM Mono',monospace";ctx.textAlign="right";ctx.fillText(fmt(mx-(rg/4)*i),pad.l-8,y+4);}
    ctx.fillStyle="rgba(255,255,255,.35)";ctx.textAlign="center";
    const steps=Math.min(6,dispLen);for(let i=0;i<steps;i++){const idx=Math.round(i*(dispLen-1)/(steps-1));ctx.fillText(`Day ${idx}`,tX(idx),H-pad.b+20);}

    // Goal line
    if(goalLine>0&&goalLine<=mx){const gy=tY(goalLine);ctx.setLineDash([8,6]);ctx.strokeStyle="rgba(255,215,0,.35)";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(pad.l,gy);ctx.lineTo(W-pad.r,gy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="rgba(255,215,0,.6)";ctx.font="bold 11px 'DM Mono',monospace";ctx.textAlign="right";ctx.fillText(`GOAL ${fmt(goalLine)}`,W-pad.r,gy-6);}

    // Projected: dashed area
    const grad=ctx.createLinearGradient(0,pad.t,0,pad.t+pH);grad.addColorStop(0,"rgba(76,217,160,.1)");grad.addColorStop(1,"rgba(76,217,160,0)");
    ctx.beginPath();ctx.moveTo(tX(0),pad.t+pH);for(let i=0;i<projSlice.length;i++)ctx.lineTo(tX(i),tY(projSlice[i]));ctx.lineTo(tX(projSlice.length-1),pad.t+pH);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
    ctx.beginPath();for(let i=0;i<projSlice.length;i++){if(i===0)ctx.moveTo(tX(i),tY(projSlice[i]));else ctx.lineTo(tX(i),tY(projSlice[i]));}
    ctx.strokeStyle="rgba(76,217,160,.35)";ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.lineJoin="round";ctx.stroke();ctx.setLineDash([]);

    // Real: solid line with dots at each data point
    if(realSlice.length>1){
      const lastV=realSlice[realSlice.length-1];const clr=lastV>=projData[0]?"#4CD9A0":"#FF6B6B";
      ctx.beginPath();
      for(let i=0;i<realSlice.length;i++){if(i===0)ctx.moveTo(tX(i),tY(realSlice[i]));else ctx.lineTo(tX(i),tY(realSlice[i]));}
      ctx.strokeStyle=clr;ctx.lineWidth=2.5;ctx.lineJoin="round";ctx.stroke();
      // Dots on each real data point for visibility
      realSlice.forEach((v,i)=>{ctx.fillStyle=v>=projData[0]?"rgba(76,217,160,.8)":"rgba(255,107,107,.8)";ctx.beginPath();ctx.arc(tX(i),tY(v),3,0,Math.PI*2);ctx.fill();});
      // End label
      const ex=tX(realSlice.length-1),ey=tY(lastV);
      ctx.fillStyle=clr;ctx.beginPath();ctx.arc(ex,ey,5,0,Math.PI*2);ctx.fill();
      ctx.font="bold 12px 'DM Mono',monospace";ctx.fillStyle=clr;ctx.textAlign="left";
      ctx.fillText(fmt(lastV),ex+10,ey+4);
    }

    // Highlight on projected
    if(hDay!==null&&hDay>=0&&hDay<projSlice.length){
      const hx=tX(hDay),hy=tY(projSlice[hDay]);
      ctx.setLineDash([4,4]);ctx.strokeStyle="rgba(76,217,160,.3)";ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(hx,pad.t);ctx.lineTo(hx,pad.t+pH);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle="#4CD9A0";ctx.beginPath();ctx.arc(hx,hy,5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#0d1117";ctx.beginPath();ctx.arc(hx,hy,2.5,0,Math.PI*2);ctx.fill();
      ctx.font="bold 13px 'DM Mono',monospace";ctx.fillStyle="#4CD9A0";ctx.textAlign="center";
      ctx.fillText(fmt(projSlice[hDay]),hx,hy-16);
    }
  },[projData,realData,goalLine,hDay,maxDay,maxVal]);
  return <div ref={dRef} style={{width:"100%",height:280}}><canvas ref={cRef}/></div>;
}

function NumSlider({label,value,min,max,step,suffix,onChange}){const pct=((value-min)/(max-min))*100;return <div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><label className="mn" style={{fontSize:13,color:"rgba(255,255,255,.5)"}}>{label}</label><div style={{display:"flex",alignItems:"center",gap:4}}><input type="number" value={value} min={min} max={max} step={step} onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v))onChange(Math.max(min,Math.min(max,v)));}} style={{width:80,padding:"4px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.04)",color:"#4CD9A0",fontSize:14,fontFamily:"'DM Mono',monospace",fontWeight:500,outline:"none",textAlign:"right"}}/>{suffix&&<span className="mn" style={{fontSize:13,color:"#4CD9A0"}}>{suffix}</span>}</div></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)} style={{width:"100%",background:`linear-gradient(to right,#4CD9A0 0%,#4CD9A0 ${pct}%,rgba(255,255,255,.08) ${pct}%,rgba(255,255,255,.08) 100%)`}}/></div>;}
function Overlay({children,onClose}){return <div className="ov"><button onClick={onClose} style={{position:"absolute",top:20,right:20,background:"none",border:"none",color:"rgba(255,255,255,.3)",fontSize:20,cursor:"pointer",padding:8,zIndex:10}}>✕</button>{children}</div>;}
function OptBtn({icon,label,selected,onClick,warn}){return <button onClick={onClick} style={{padding:"14px 18px",borderRadius:10,border:`1px solid ${selected?"rgba(76,217,160,.4)":warn?"rgba(255,107,107,.2)":"rgba(255,255,255,.08)"}`,background:selected?"rgba(76,217,160,.08)":"rgba(255,255,255,.03)",color:"#e6edf3",fontSize:14,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",transition:"all .2s",textAlign:"left",display:"flex",alignItems:"center",gap:12,width:"100%"}} onMouseEnter={e=>{if(!selected){e.currentTarget.style.borderColor="rgba(255,255,255,.15)";e.currentTarget.style.background="rgba(255,255,255,.05)";}}} onMouseLeave={e=>{if(!selected){e.currentTarget.style.borderColor=warn?"rgba(255,107,107,.2)":"rgba(255,255,255,.08)";e.currentTarget.style.background="rgba(255,255,255,.03)";}}}>
  <span style={{fontSize:20,flexShrink:0}}>{icon}</span><span>{label}</span></button>;}
function ActBtn({icon,label,color,onClick,pulse,ghostFloat}){return <button onClick={onClick} style={{padding:"16px 32px",borderRadius:12,border:`1px solid rgba(${color},.3)`,background:`rgba(${color},.06)`,color:`rgb(${color})`,fontSize:15,fontFamily:"'DM Sans',sans-serif",fontWeight:600,cursor:"pointer",transition:"all .3s",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:10,animation:pulse?"pulse 3s ease-in-out infinite":"none"}} onMouseEnter={e=>{e.currentTarget.style.background=`rgba(${color},.12)`;e.currentTarget.style.transform="translateY(-1px)";}} onMouseLeave={e=>{e.currentTarget.style.background=`rgba(${color},.06)`;e.currentTarget.style.transform="translateY(0)";}}><span style={{fontSize:18,animation:ghostFloat?"ghostFloat 2s ease-in-out infinite":"none"}}>{icon}</span>{label}</button>;}
function Breathe({size=50}){return <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}><div style={{width:size,height:size,borderRadius:"50%",border:"2px solid rgba(76,217,160,.4)",display:"flex",alignItems:"center",justifyContent:"center",animation:"breathe 4s ease-in-out infinite"}}><div style={{width:size/2,height:size/2,borderRadius:"50%",background:"radial-gradient(circle,rgba(76,217,160,.3),transparent)",animation:"breathe 4s ease-in-out infinite reverse"}}/></div><span style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:2,textTransform:"uppercase"}}>breathe</span></div>;}

// Recent trades mini-display
function RecentTrades({entries,limit=5}){
  const trades=entries.filter(e=>e.type==="daytrade"||e.type==="prediction").slice(-limit).reverse();
  if(trades.length===0)return null;
  const wins=trades.filter(t=>t.amount>0).length;
  const losses=trades.filter(t=>t.amount<0).length;
  return <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:10,padding:12,marginBottom:20}}>
    <div className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>Your Last {trades.length} Trades — {wins}W {losses}L</div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{trades.map((t,i)=><span key={i} className="mn" style={{fontSize:13,fontWeight:600,padding:"4px 10px",borderRadius:6,background:t.amount>=0?"rgba(76,217,160,.08)":"rgba(255,107,107,.08)",color:t.amount>=0?"#4CD9A0":"#FF6B6B",border:`1px solid ${t.amount>=0?"rgba(76,217,160,.15)":"rgba(255,107,107,.15)"}`}}>{t.amount>=0?"+":""}{fmt(t.amount)}</span>)}</div>
    {losses>=3&&<p style={{fontSize:12,color:"#FF6B6B",marginTop:8}}>You've lost {losses} of your last {trades.length}. Are you sure this next one is different?</p>}
  </div>;
}

/* ═══ GHOST CHECKPOINT (rewritten — harder, pattern-aware) ═══ */
function GhostCheck({onClose,onLog,dailyGain,liveBal,entries,compoundData,finalValue}){
  const [step,setStep]=useState(0),[ans,setAns]=useState({}),[verd,setVerd]=useState(null);
  const [tradeType,setTradeType]=useState(null); // "daytrade" or "prediction"

  const phase1=[{id:"what",q:"What kind of trade is this?",opts:[{l:"Day trade — stocks/options",v:"daytrade",i:"📈"},{l:"Prediction market event",v:"prediction",i:"🎯"}]}];

  const coreQs={
    daytrade:[
      {id:"origin",q:"Be honest — where did you first see this?",opts:[
        {l:"I watched it moon and now I want in",v:"ghost",i:"👻",w:true},
        {l:"It was on my pre-market watchlist with a plan",v:"planned",i:"📋"},
        {l:"Someone on Twitter/Discord posted about it",v:"social",i:"📱",w:true},
        {l:"I just spotted the setup forming live",v:"fresh",i:"🔍"}]},
      {id:"honesty",q:"\"It still has room to run\" — is that your actual analysis, or a feeling?",opts:[
        {l:"Honestly? It's a feeling. I see green and I want in.",v:"feeling",i:"🫣",w:true},
        {l:"I have a technical level where I expect a move to",v:"analysis",i:"📊"},
        {l:"I don't know. I just don't want to miss it.",v:"fomo",i:"😰",w:true}]},
      {id:"risk",q:"If this trade goes against you RIGHT NOW — what's your max loss?",opts:[
        {l:"I know exactly: it's $___ and I'm okay with it",v:"defined",i:"🛡️"},
        {l:"I haven't calculated it yet",v:"unknown",i:"❓",w:true},
        {l:"I'll move my stop if it gets close",v:"moving",i:"🎲",w:true},
        {l:"I don't use stops on this kind of trade",v:"none",i:"💀",w:true}]},
      {id:"size",q:"Is this position sized the same as your last winning trade, or bigger?",opts:[
        {l:"Same as always — standard size",v:"standard",i:"📏"},
        {l:"Bigger — I'm more confident on this one",v:"bigger",i:"⚠️",w:true},
        {l:"Bigger — I need to make back what I lost",v:"revenge",i:"🔥",w:true},
        {l:"I haven't thought about size yet",v:"unknown",i:"❓",w:true}]}
    ],
    prediction:[
      {id:"origin",q:"What's driving this prediction market trade?",opts:[
        {l:"I have genuine conviction based on research",v:"research",i:"🔬"},
        {l:"The odds feel wrong — easy money",v:"odds",i:"🎰",w:true},
        {l:"I saw someone else's position and want to follow",v:"social",i:"📱",w:true},
        {l:"It's moving and I want in before it shifts more",v:"chasing",i:"⏰",w:true}]},
      {id:"honesty",q:"If the market is pricing this at those odds, what do you know that everyone else doesn't?",opts:[
        {l:"Honestly I don't have an edge, I just have a gut feeling",v:"gut",i:"🫣",w:true},
        {l:"I've done specific research most people haven't",v:"edge",i:"📊"},
        {l:"I think the market is just slow to react",v:"slow",i:"🤷",w:true}]},
      {id:"risk",q:"If you're wrong, how much are you losing?",opts:[
        {l:"A small amount I've defined and am okay with",v:"defined",i:"🛡️"},
        {l:"More than I usually risk because I'm 'sure'",v:"oversized",i:"💀",w:true},
        {l:"I'll add to the position if it goes against me",v:"averaging",i:"🔥",w:true}]},
      {id:"count",q:"How many prediction trades have you made today?",opts:[
        {l:"This is my first or second today",v:"normal",i:"✅"},
        {l:"More than my usual — I keep seeing opportunities",v:"overtrading",i:"🔄",w:true}]}
    ]
  };

  const allQs=tradeType?[...phase1,...coreQs[tradeType]]:phase1;
  const evaluate=a=>{let r=0;const flags=Object.values(a);
    // Each answer that has w:true in its question adds to red flags
    if(a.origin==="ghost")r+=3;if(a.origin==="social"||a.origin==="chasing")r+=3;
    if(a.honesty==="feeling"||a.honesty==="fomo"||a.honesty==="gut"||a.honesty==="slow")r+=3;
    if(a.risk==="unknown"||a.risk==="moving"||a.risk==="none"||a.risk==="oversized"||a.risk==="averaging")r+=3;
    if(a.size==="bigger"||a.size==="revenge"||a.size==="unknown")r+=2;
    if(a.count==="overtrading")r+=2;
    if(a.origin==="odds")r+=1;
    return r>=5?"ghost":r>=2?"risky":"pass";};

  const pk=(qid,val)=>{
    const n={...ans,[qid]:val};setAns(n);
    if(qid==="what"){setTradeType(val);setTimeout(()=>setStep(step+1),300);return;}
    const totalQs=1+coreQs[tradeType].length;
    if(step<totalQs-1)setTimeout(()=>setStep(step+1),300);
    else{const r=evaluate(n);setTimeout(()=>{setVerd(r);if(r!=="pass")onLog(r);},400);}
  };

  const vd={
    ghost:{icon:"👻",title:"You're Chasing a Ghost",color:"#FF6B6B",
      msg:tradeType==="prediction"?"You don't have an edge — you have a feeling dressed up as conviction. The prediction market is pricing in information you don't have.":"The move already happened. You're not early — you're late. The setup that made this work is over. You're buying someone else's exit.",
      advice:"Close the app. Walk away for 15 minutes. If you come back and still want it, ask yourself: would I take this trade if I was DOWN today?"},
    risky:{icon:"⚠️",title:"Yellow Flags",color:"#FFB347",
      msg:"Parts of your process are off. This might be a real trade, but you're not treating it like one.",
      advice:"Before you enter: write down your EXACT entry, stop, and target. If you can't fill all three in 10 seconds, you're gambling."},
    pass:{icon:"✅",title:"Trade Looks Clean",color:"#4CD9A0",
      msg:"Planned, researched, defined risk. This is how you compound.",
      advice:`Stick to your plan. ${dailyGain}% at a time. No heroics.`}};

  const totalQs=tradeType?1+coreQs[tradeType].length:1;
  const pct=((step+(verd?1:0))/totalQs)*100;
  const currentQ=allQs[step];

  return <Overlay onClose={onClose}>
    <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"rgba(255,255,255,.05)"}}><div style={{height:"100%",width:`${pct}%`,background:verd?vd[verd].color:"#4CD9A0",transition:"width .4s,background .4s",borderRadius:"0 2px 2px 0"}}/></div>
    {!verd?<div style={{animation:"slideIn .3s ease-out",maxWidth:440,width:"100%"}} key={step}>
      {step===0&&<RecentTrades entries={entries}/>}
      <div className="mn" style={{fontSize:11,letterSpacing:3,textTransform:"uppercase",color:"rgba(255,255,255,.3)",marginBottom:8}}>{step===0?"Before You Trade":"Ghost Check "+(step)+"/"+( totalQs-1)}</div>
      <h2 className="sf" style={{fontSize:22,fontWeight:700,margin:"0 0 24px",color:"#e6edf3",lineHeight:1.3}}>{currentQ.q}</h2>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>{currentQ.opts.map(o=><OptBtn key={o.v} icon={o.i} label={o.l} selected={ans[currentQ.id]===o.v} warn={o.w} onClick={()=>pk(currentQ.id,o.v)}/>)}</div>
    </div>
    :<div style={{animation:"slideIn .4s ease-out",maxWidth:440,width:"100%",textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>{vd[verd].icon}</div>
      <h2 className="sf" style={{fontSize:28,fontWeight:700,margin:"0 0 16px",color:vd[verd].color}}>{vd[verd].title}</h2>
      <p style={{fontSize:15,color:"rgba(255,255,255,.55)",lineHeight:1.7,maxWidth:400,margin:"0 auto 12px"}}>{vd[verd].msg}</p>
      <p style={{fontSize:14,color:vd[verd].color,fontWeight:500,maxWidth:400,margin:"0 auto 24px"}}>{vd[verd].advice}</p>
      {verd==="ghost"&&liveBal>0&&<div style={{background:"rgba(255,107,107,.04)",border:"1px solid rgba(255,107,107,.1)",borderRadius:10,padding:16,marginBottom:24}}>
        <p style={{fontSize:14,color:"rgba(255,255,255,.5)",lineHeight:1.6,margin:0}}>Your balance is <strong style={{color:"#e6edf3"}}>{fmt(liveBal)}</strong>. At <strong style={{color:"#4CD9A0"}}>{dailyGain}%/day</strong>, that's <strong style={{color:"#e6edf3"}}>{fmt(liveBal*dailyGain/100)}</strong> today. You don't need this trade.</p>
      </div>}
      <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}><button onClick={onClose} className="bg">← Back to my plan</button><button onClick={()=>{setStep(0);setAns({});setVerd(null);setTradeType(null);}} className="bd">Check another</button></div>
    </div>}
  </Overlay>;
}

/* ═══ TILT DETECTOR (rewritten — pattern-aware, harder hitting) ═══ */
function TiltCheck({onClose,onLog,dailyGain,liveBal,entries}){
  const [step,setStep]=useState(0),[ans,setAns]=useState({}),[verd,setVerd]=useState(null);
  const todayTrades=entries.filter(e=>(e.type==="daytrade"||e.type==="prediction")&&e.date===dk());
  const todayPnl=todayTrades.reduce((s,e)=>s+e.amount,0);
  const todayCount=todayTrades.length;

  const qs=[
    {id:"state",q:todayPnl<0?`You're down ${fmt(Math.abs(todayPnl))} today. Why are you still looking at screens?`:"How's your P&L today — and how does it make you FEEL?",opts:[
      {l:todayPnl<0?"I need to make it back before close":"I'm down and need to recover",v:"revenge",i:"😤",w:true},
      {l:"I'm calm and following my process",v:"calm",i:"😐"},
      {l:"I'm up and feel untouchable right now",v:"invincible",i:"🤑",w:true},
      {l:"First trade of the day",v:"fresh",i:"☀️"}]},
    {id:"trigger",q:"What JUST happened in the last 5 minutes that made you want to trade?",opts:[
      {l:"I saw a big red candle and I want to buy the dip",v:"dip",i:"📉",w:true},
      {l:"I saw a big green candle and want to ride it",v:"chase",i:"📈",w:true},
      {l:"Nothing — this has been on my plan since pre-market",v:"planned",i:"📋"},
      {l:"I'm bored and scrolling looking for something to happen",v:"bored",i:"😶",w:true}]},
    {id:"sizing",q:"Real talk: is this position bigger than your last one?",opts:[
      {l:"Same size I always trade",v:"standard",i:"📏"},
      {l:"Bigger — I'm trying to make up for earlier",v:"revenge",i:"🔥",w:true},
      {l:"Bigger — this one feels like a sure thing",v:"sure_thing",i:"💰",w:true},
      {l:"I haven't calculated yet, I just want in",v:"yolo",i:"🎲",w:true}]},
    {id:"walkaway",q:"If I told you to close your laptop and come back tomorrow — what's your gut reaction?",opts:[
      {l:"Fine. I'd be okay with that.",v:"fine",i:"🧘"},
      {l:"No way — I can't end the day like this",v:"cant_stop",i:"😤",w:true},
      {l:"But this opportunity will be gone...",v:"scarcity",i:"⏰",w:true},
      {l:"I'd feel relieved, honestly",v:"relieved",i:"😮‍💨"}]}
  ];

  const evaluate=a=>{let r=0;
    if(a.state==="revenge")r+=3;if(a.state==="invincible")r+=2;
    if(a.trigger==="dip"||a.trigger==="chase")r+=2;if(a.trigger==="bored")r+=2;
    if(a.sizing==="revenge"||a.sizing==="sure_thing")r+=3;if(a.sizing==="yolo")r+=3;
    if(a.walkaway==="cant_stop")r+=3;if(a.walkaway==="scarcity")r+=2;
    return r>=5?"tilted":r>=2?"warning":"clear";};

  const pk=(qid,val)=>{const n={...ans,[qid]:val};setAns(n);if(step<qs.length-1)setTimeout(()=>setStep(step+1),300);else{const r=evaluate(n);setTimeout(()=>{setVerd(r);if(r!=="clear")onLog(r);},400);}};

  const vd={
    tilted:{icon:"🛑",title:"You're on Full Tilt",color:"#FF6B6B",
      msg:`You've made ${todayCount} trade${todayCount!==1?"s":""} today${todayPnl<0?` and you're down ${fmt(Math.abs(todayPnl))}.`:todayPnl>0?` and you're up ${fmt(todayPnl)} — don't give it back.`:"."} Every revenge trade you've ever taken — honestly — how many actually worked? You already know the answer.`,
      advice:"Close the platform. Not minimize — CLOSE. Go outside. The money you save by not taking this trade IS your profit today."},
    warning:{icon:"⚠️",title:"Your Head Isn't Right",color:"#FFB347",
      msg:"You're not in full tilt, but something is off. You're making decisions faster than you should be.",
      advice:"Set a timer for 10 minutes. Don't look at any charts. If the trade is still there after, take it at HALF your normal size. Not full. Half."},
    clear:{icon:"🧘",title:"You're Trading Clean",color:"#4CD9A0",msg:"Process looks solid. Logic over emotion.",advice:`Stay the course. ${dailyGain}% at a time.`}};

  const pct=((step+(verd?1:0))/qs.length)*100;
  const lt=[{l:"5%",n:"5.3%",d:Math.ceil(Math.log(1/.95)/Math.log(1+dailyGain/100))},{l:"10%",n:"11.1%",d:Math.ceil(Math.log(1/.9)/Math.log(1+dailyGain/100))},{l:"20%",n:"25.0%",d:Math.ceil(Math.log(1/.8)/Math.log(1+dailyGain/100))},{l:"50%",n:"100%",d:Math.ceil(Math.log(1/.5)/Math.log(1+dailyGain/100))}];

  return <Overlay onClose={onClose}>
    <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"rgba(255,255,255,.05)"}}><div style={{height:"100%",width:`${pct}%`,background:verd?vd[verd].color:"#FFB347",transition:"width .4s,background .4s",borderRadius:"0 2px 2px 0"}}/></div>
    {!verd?<div style={{animation:"slideIn .3s ease-out",maxWidth:440,width:"100%"}} key={step}>
      {step===0&&<RecentTrades entries={entries}/>}
      <div className="mn" style={{fontSize:11,letterSpacing:3,textTransform:"uppercase",color:"rgba(255,255,255,.3)",marginBottom:8}}>Tilt Check {step+1}/{qs.length}</div>
      <h2 className="sf" style={{fontSize:22,fontWeight:700,margin:"0 0 24px",color:"#e6edf3",lineHeight:1.3}}>{qs[step].q}</h2>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>{qs[step].opts.map(o=><OptBtn key={o.v} icon={o.i} label={o.l} selected={ans[qs[step].id]===o.v} warn={o.w} onClick={()=>pk(qs[step].id,o.v)}/>)}</div>
    </div>
    :<div style={{animation:"slideIn .4s ease-out",maxWidth:440,width:"100%",textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>{vd[verd].icon}</div>
      <h2 className="sf" style={{fontSize:28,fontWeight:700,margin:"0 0 16px",color:vd[verd].color}}>{vd[verd].title}</h2>
      <p style={{fontSize:15,color:"rgba(255,255,255,.55)",lineHeight:1.7,maxWidth:420,margin:"0 auto 12px"}}>{vd[verd].msg}</p>
      <p style={{fontSize:14,color:vd[verd].color,fontWeight:500,maxWidth:400,margin:"0 auto 28px"}}>{vd[verd].advice}</p>
      {verd==="tilted"&&<div style={{background:"rgba(255,107,107,.04)",border:"1px solid rgba(255,107,107,.12)",borderRadius:12,padding:"18px 20px",marginBottom:24,textAlign:"left"}}>
        <div className="mn" style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"rgba(255,255,255,.3)",marginBottom:12,textAlign:"center"}}>The math of losing</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px 12px",fontSize:13,fontFamily:"'DM Mono',monospace"}}>
          <span style={{color:"rgba(255,255,255,.3)",fontSize:10,textTransform:"uppercase",letterSpacing:1}}>You lose</span><span style={{color:"rgba(255,255,255,.3)",fontSize:10,textTransform:"uppercase",letterSpacing:1}}>Need back</span><span style={{color:"rgba(255,255,255,.3)",fontSize:10,textTransform:"uppercase",letterSpacing:1}}>Days @{dailyGain}%</span>
          {lt.map((r,i)=><Fragment key={i}><span style={{color:"#FF6B6B"}}>-{r.l}</span><span style={{color:"#FFB347"}}>+{r.n}</span><span style={{color:"#e6edf3"}}>{r.d} days</span></Fragment>)}
        </div></div>}
      {verd==="warning"&&<div style={{background:"rgba(255,179,71,.06)",border:"1px solid rgba(255,179,71,.15)",borderRadius:10,padding:16,marginBottom:24,textAlign:"center"}}><Breathe/><p style={{fontSize:13,color:"rgba(255,255,255,.5)",marginTop:12,lineHeight:1.6}}>10 slow breaths. Half size. No exceptions.</p></div>}
      <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}><button onClick={onClose} className="bg">← Back to my plan</button><button onClick={()=>{setStep(0);setAns({});setVerd(null);}} className="bd">Check again</button></div>
    </div>}
  </Overlay>;
}

/* ═══ VARIANCE SIMULATOR (with instructions) ═══ */
function VarSim({onClose,capital,dailyGain}){
  const [variance,setVariance]=useState(2),[blowPct,setBlowPct]=useState(30),[blowFreq,setBlowFreq]=useState(5),[days,setDays]=useState(60),[seed,setSeed]=useState(42),[showHelp,setShowHelp]=useState(true);
  const{disc,real}=useMemo(()=>{let s=seed;const rand=()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};const disc=[capital],real=[capital];for(let i=1;i<=days;i++){disc.push(disc[i-1]*(1+dailyGain/100));const blow=blowFreq>0&&rand()<blowFreq/100;if(blow)real.push(real[i-1]*(1-blowPct/100));else{const dr=dailyGain+(rand()*2-1)*variance;real.push(real[i-1]*(1+dr/100));}}return{disc,real};},[capital,dailyGain,variance,blowPct,blowFreq,days,seed]);
  const fD=disc[disc.length-1],fR=real[real.length-1],diff=fR-fD;
  let worstDay=0,worstDrop=0;for(let i=1;i<real.length;i++){const d=((real[i]-real[i-1])/real[i-1])*100;if(d<worstDrop){worstDrop=d;worstDay=i;}}
  const recDays=worstDrop<0?Math.ceil(Math.log(1/(1+worstDrop/100))/Math.log(1+dailyGain/100)):0;
  const all=[...disc,...real],mx=Math.max(...all),mn=Math.min(...all),rg=mx-mn||1,mxL=disc.length,W=400,H=120;
  const tX=i=>(i/(mxL-1))*W,tY=v=>H-((v-mn)/rg)*H;

  return <Overlay onClose={onClose}>
    <div style={{maxWidth:500,width:"100%",maxHeight:"88vh",overflowY:"auto",textAlign:"left"}}>
      <h2 className="sf" style={{fontSize:24,fontWeight:700,margin:"0 0 6px",color:"#e6edf3",textAlign:"center"}}>Reality vs. Discipline</h2>
      <p style={{fontSize:13,color:"rgba(255,255,255,.35)",marginBottom:16,textAlign:"center"}}>What happens when one cocky day destroys a winning streak.</p>

      {/* Instructions toggle */}
      <button onClick={()=>setShowHelp(!showHelp)} style={{width:"100%",padding:"10px 16px",borderRadius:8,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.02)",color:"rgba(255,255,255,.5)",fontSize:13,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",marginBottom:12,textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>ℹ️ How to use this simulator</span><span style={{fontSize:11}}>{showHelp?"▲":"▼"}</span>
      </button>
      {showHelp&&<div style={{background:"rgba(76,217,160,.03)",border:"1px solid rgba(76,217,160,.08)",borderRadius:10,padding:16,marginBottom:16,fontSize:13,color:"rgba(255,255,255,.5)",lineHeight:1.7}}>
        <p style={{margin:"0 0 8px"}}><strong style={{color:"#e6edf3"}}>Daily Variance</strong> — how much your returns swing day-to-day. A 2% variance on a 0.5% target means some days you make 2.5%, some days you lose 1.5%. Higher = choppier results.</p>
        <p style={{margin:"0 0 8px"}}><strong style={{color:"#e6edf3"}}>Blowup Size</strong> — when you have a bad day (go on tilt, revenge trade, size up too big), how much of your account do you lose? 30% is common for undisciplined traders.</p>
        <p style={{margin:"0 0 8px"}}><strong style={{color:"#e6edf3"}}>Blowup Chance</strong> — what % chance each day that you lose discipline. Even 5% means roughly 1 blowup every 20 trading days.</p>
        <p style={{margin:0}}><strong style={{color:"#e6edf3"}}>Sim Days</strong> — how many days to simulate. Hit <strong style={{color:"#4CD9A0"}}>Re-roll</strong> to run a new random simulation with the same settings.</p>
        <p style={{margin:"8px 0 0",color:"rgba(255,255,255,.35)",fontSize:12}}>The dashed green line is what happens if you're perfectly disciplined. The solid line is what actually happens with variance and blowups. Run it a few times — the disciplined path wins almost every time.</p>
      </div>}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        {[{l:"Daily Variance (%)",v:variance,fn:setVariance,mn:0,mx:50,st:.5},{l:"Blowup Size (%)",v:blowPct,fn:setBlowPct,mn:5,mx:90,st:5},{l:"Blowup Chance (%/day)",v:blowFreq,fn:setBlowFreq,mn:0,mx:30,st:1},{l:"Sim Days",v:days,fn:setDays,mn:10,mx:252,st:1}].map((c,i)=><div key={i}><label className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:1,textTransform:"uppercase"}}>{c.l}</label><input type="number" value={c.v} min={c.mn} max={c.mx} step={c.st} onChange={e=>c.fn(Math.max(c.mn,Math.min(c.mx,+e.target.value)))} style={{width:"100%",marginTop:4,padding:"8px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.04)",color:"#e6edf3",fontSize:14,fontFamily:"'DM Mono',monospace",outline:"none",textAlign:"center"}}/></div>)}
      </div>
      <button onClick={()=>setSeed(Math.floor(Math.random()*99999))} style={{width:"100%",padding:10,borderRadius:8,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.03)",color:"rgba(255,255,255,.5)",fontSize:13,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",marginBottom:16}}>🎲 Re-roll Simulation</button>
      <div style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"center",gap:20,marginBottom:8,fontSize:11}}><span className="mn" style={{color:"rgba(76,217,160,.6)"}}>--- Disciplined</span><span className="mn" style={{color:fR>=capital?"#4CD9A0":"#FF6B6B"}}>━ Reality</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:120}}><polyline points={disc.map((v,i)=>`${tX(i)},${tY(v)}`).join(" ")} fill="none" stroke="rgba(76,217,160,.4)" strokeWidth="2" strokeDasharray="6 4"/><polyline points={real.map((v,i)=>`${tX(i)},${tY(v)}`).join(" ")} fill="none" stroke={fR>=capital?"#4CD9A0":"#FF6B6B"} strokeWidth="2.5" strokeLinejoin="round"/></svg>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
        <div style={{background:"rgba(76,217,160,.04)",border:"1px solid rgba(76,217,160,.1)",borderRadius:10,padding:"12px 14px",textAlign:"center"}}><div className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Disciplined</div><div className="mn" style={{fontSize:18,fontWeight:700,color:"#4CD9A0"}}>{fmt(fD)}</div></div>
        <div style={{background:fR>=capital?"rgba(76,217,160,.04)":"rgba(255,107,107,.04)",border:`1px solid ${fR>=capital?"rgba(76,217,160,.1)":"rgba(255,107,107,.1)"}`,borderRadius:10,padding:"12px 14px",textAlign:"center"}}><div className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>With Blowups</div><div className="mn" style={{fontSize:18,fontWeight:700,color:fR>=capital?"#4CD9A0":"#FF6B6B"}}>{fmt(fR)}</div></div>
      </div>
      <div style={{background:"rgba(255,107,107,.04)",border:"1px solid rgba(255,107,107,.1)",borderRadius:12,padding:16,textAlign:"center"}}><div className="mn" style={{fontSize:11,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:8}}>Cost of Being Cocky</div><div className="mn" style={{fontSize:24,fontWeight:700,color:diff>=0?"#4CD9A0":"#FF6B6B"}}>{diff>=0?"+":""}{fmt(diff)}</div>{worstDrop<0&&<p style={{fontSize:13,color:"rgba(255,255,255,.4)",marginTop:8,lineHeight:1.5}}>Worst day: <strong style={{color:"#FF6B6B"}}>{worstDrop.toFixed(1)}%</strong> (Day {worstDay}). Takes <strong style={{color:"#FF6B6B"}}>{recDays} disciplined days</strong> to recover.</p>}</div>
    </div>
  </Overlay>;
}

/* ═══ P&L TRACKER ═══ */
function PLTracker({onClose,entries,onAdd,onReset,liveBal,totalDeposited,tradePnl,dayPnl,predPnl}){
  const [amount,setAmount]=useState("");const [note,setNote]=useState("");const [mode,setMode]=useState("daytrade");
  const todayE=entries.filter(e=>(e.type==="daytrade"||e.type==="prediction")&&e.date===dk());
  const todayPnl=todayE.reduce((s,e)=>s+e.amount,0);
  const doAdd=()=>{const v=parseFloat(amount);if(isNaN(v)||v===0)return;const now=new Date();const entry={amount:mode==="withdraw"?-Math.abs(v):mode==="deposit"?Math.abs(v):v,note:note.trim()||(mode==="deposit"?"Deposit":mode==="withdraw"?"Withdrawal":""),date:dk(),time:now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),id:Date.now().toString(36),type:mode};onAdd(entry);setAmount("");setNote("");};
  const modeBtn=(m,label,emoji)=><button onClick={()=>setMode(m)} style={{flex:1,padding:"7px 0",borderRadius:6,border:`1px solid ${mode===m?"rgba(76,217,160,.3)":"rgba(255,255,255,.08)"}`,background:mode===m?"rgba(76,217,160,.08)":"transparent",color:mode===m?"#4CD9A0":"rgba(255,255,255,.4)",fontSize:11,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",transition:"all .2s"}}>{emoji} {label}</button>;

  // Build equity array
  const sorted=[...entries].sort((a,b)=>a.date<b.date?-1:1);
  const balArr=[totalDeposited||0];sorted.forEach(e=>balArr.push(balArr[balArr.length-1]+e.amount));

  return <Overlay onClose={onClose}>
    <div style={{maxWidth:500,width:"100%",maxHeight:"88vh",overflowY:"auto",textAlign:"left"}}>
      <h2 className="sf" style={{fontSize:24,fontWeight:700,margin:"0 0 6px",color:"#e6edf3",textAlign:"center"}}>P&L Tracker</h2>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:10,padding:"10px",textAlign:"center"}}><div className="mn" style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:1}}>Balance</div><div className="mn" style={{fontSize:18,fontWeight:700,color:"#e6edf3",marginTop:2}}>{fmt(liveBal)}</div></div>
        <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:10,padding:"10px",textAlign:"center"}}><div className="mn" style={{fontSize:9,color:"rgba(255,255,255,.3)",textTransform:"uppercase",letterSpacing:1}}>Today</div><div className="mn" style={{fontSize:18,fontWeight:700,color:todayPnl>=0?"#4CD9A0":"#FF6B6B",marginTop:2}}>{todayPnl>=0?"+":""}{fmt(todayPnl)}</div></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
        <div style={{background:"rgba(255,255,255,.02)",borderRadius:8,padding:"8px",textAlign:"center"}}><div className="mn" style={{fontSize:9,color:"rgba(255,255,255,.25)",textTransform:"uppercase"}}>Day Trades</div><div className="mn" style={{fontSize:14,fontWeight:600,color:dayPnl>=0?"#4CD9A0":"#FF6B6B",marginTop:2}}>{dayPnl>=0?"+":""}{fmt(dayPnl)}</div></div>
        <div style={{background:"rgba(255,255,255,.02)",borderRadius:8,padding:"8px",textAlign:"center"}}><div className="mn" style={{fontSize:9,color:"rgba(255,255,255,.25)",textTransform:"uppercase"}}>Predictions</div><div className="mn" style={{fontSize:14,fontWeight:600,color:predPnl>=0?"#4CD9A0":"#FF6B6B",marginTop:2}}>{predPnl>=0?"+":""}{fmt(predPnl)}</div></div>
        <div style={{background:"rgba(255,255,255,.02)",borderRadius:8,padding:"8px",textAlign:"center"}}><div className="mn" style={{fontSize:9,color:"rgba(255,255,255,.25)",textTransform:"uppercase"}}>All Trades</div><div className="mn" style={{fontSize:14,fontWeight:600,color:tradePnl>=0?"#4CD9A0":"#FF6B6B",marginTop:2}}>{tradePnl>=0?"+":""}{fmt(tradePnl)}</div></div>
      </div>
      {balArr.length>2&&<div style={{marginBottom:16}}><Sparkline data={balArr} color={tradePnl>=0?"#4CD9A0":"#FF6B6B"}/></div>}
      <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,padding:14,marginBottom:16}}>
        <div style={{display:"flex",gap:5,marginBottom:10}}>{modeBtn("daytrade","Day Trade","📈")}{modeBtn("prediction","Prediction","🎯")}{modeBtn("deposit","Deposit","💰")}{modeBtn("withdraw","Withdraw","🏧")}</div>
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <input type="number" placeholder={mode==="daytrade"||mode==="prediction"?"P&L ($)":"Amount ($)"} value={amount} onChange={e=>setAmount(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")doAdd();}} style={{flex:1,padding:"10px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.04)",color:"#e6edf3",fontSize:14,fontFamily:"'DM Mono',monospace",outline:"none"}}/>
          <input type="text" placeholder="Note" value={note} onChange={e=>setNote(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")doAdd();}} style={{flex:1.2,padding:"10px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.04)",color:"#e6edf3",fontSize:14,fontFamily:"'DM Sans',sans-serif",outline:"none"}}/>
        </div>
        <button onClick={doAdd} style={{width:"100%",padding:10,borderRadius:8,border:"1px solid rgba(76,217,160,.3)",background:"rgba(76,217,160,.08)",color:"#4CD9A0",fontSize:14,fontFamily:"'DM Sans',sans-serif",fontWeight:500,cursor:"pointer"}}>{mode==="deposit"?"+ Deposit":mode==="withdraw"?"- Withdraw":"+ Log "+( mode==="prediction"?"Prediction":"Trade")}</button>
      </div>
      {entries.length>0&&<div style={{marginBottom:16}}><div className="mn" style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>Recent</div><div style={{display:"flex",flexDirection:"column",gap:3}}>{[...entries].reverse().slice(0,25).map((e,i)=><div key={e.id||i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",borderRadius:6,background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.04)"}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:11}}>{e.type==="deposit"?"💰":e.type==="withdraw"?"🏧":e.type==="prediction"?"🎯":"📈"}</span><span className="mn" style={{fontSize:13,fontWeight:600,color:e.amount>=0?"#4CD9A0":"#FF6B6B"}}>{e.amount>=0?"+":""}{fmt(e.amount)}</span>{e.note&&<span style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>{e.note}</span>}</div>
        <span className="mn" style={{fontSize:10,color:"rgba(255,255,255,.2)"}}>{sd(e.date)}</span></div>)}</div></div>}
      <div style={{textAlign:"center",paddingBottom:16}}><button onClick={()=>{if(confirm("Reset all data?"))onReset();}} style={{padding:"8px 20px",borderRadius:6,border:"1px solid rgba(255,107,107,.15)",background:"transparent",color:"rgba(255,107,107,.5)",fontSize:12,fontFamily:"'DM Sans',sans-serif",cursor:"pointer"}}>Reset All Data</button></div>
    </div>
  </Overlay>;
}

/* ═══ DISCIPLINE LOG ═══ */
function DiscLog({entries,onClose}){return <Overlay onClose={onClose}><div style={{maxWidth:440,width:"100%",textAlign:"left",maxHeight:"80vh",overflowY:"auto"}}><h2 className="sf" style={{fontSize:24,fontWeight:700,margin:"0 0 8px",color:"#e6edf3",textAlign:"center"}}>Discipline Log</h2><p style={{fontSize:13,color:"rgba(255,255,255,.35)",marginBottom:24,textAlign:"center"}}>Every entry = capital you protected.</p>{entries.length===0?<div style={{textAlign:"center",padding:40,color:"rgba(255,255,255,.2)",fontSize:14}}>No entries yet.</div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>{[...entries].reverse().map((e,i)=><div key={e.id||i} style={{padding:"12px 16px",borderRadius:8,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><span style={{fontSize:14,color:"#e6edf3"}}>{e.type==="ghost"?"👻 Ghost blocked":e.type==="risky"?"⚠️ Risky flagged":e.type==="tilted"?"🛑 Tilt walked away":"⚠️ Tilt warning"}</span><div className="mn" style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:4}}>{e.time}</div></div><span className="mn" style={{fontSize:11,padding:"4px 10px",borderRadius:20,background:e.type==="ghost"||e.type==="tilted"?"rgba(255,107,107,.1)":"rgba(255,179,71,.1)",color:e.type==="ghost"||e.type==="tilted"?"#FF6B6B":"#FFB347",flexShrink:0}}>avoided</span></div>)}</div>}<div style={{marginTop:24,padding:16,borderRadius:8,background:"rgba(76,217,160,.04)",border:"1px solid rgba(76,217,160,.1)",textAlign:"center"}}><span style={{fontSize:13,color:"rgba(255,255,255,.5)"}}>Trades avoided: </span><span className="mn" style={{fontSize:15,color:"#4CD9A0",fontWeight:600}}>{entries.length}</span></div></div></Overlay>;}

/* ═══ MAIN APP ═══ */
export default function App(){
  const [user,setUser]=useState(undefined); // undefined=loading, null=signed out, obj=signed in
  const [dailyGain,setDailyGain]=useState(0.5);const [tradingDays,setTradingDays]=useState(252);const [goal,setGoal]=useState(5000);
  const [hDay,setHDay]=useState(null);const [qIdx,setQIdx]=useState(0);const [fadeIn,setFadeIn]=useState(true);
  const [plEntries,setPlEntries]=useState([]);const [discLog,setDiscLog]=useState([]);const [loaded,setLoaded]=useState(false);
  const [showGhost,setShowGhost]=useState(false);const [showTilt,setShowTilt]=useState(false);
  const [showPL,setShowPL]=useState(false);const [showSim,setShowSim]=useState(false);const [showLog,setShowLog]=useState(false);
  const [chartZoom,setChartZoom]=useState("full");
  const saveTimer=useRef(null);
  const skipSync=useRef(false); // prevent feedback loops

  // Auth listener
  useEffect(()=>{const unsub=onAuthStateChanged(auth,u=>setUser(u||null));return unsub;},[]);

  // Subscribe to Firestore when logged in
  useEffect(()=>{
    if(!user||user===undefined)return;
    const unsub=subscribeToUserData(user.uid,(data)=>{
      if(skipSync.current){skipSync.current=false;return;}
      if(data){
        if(data.plEntries)setPlEntries(data.plEntries);
        if(data.discLog)setDiscLog(data.discLog);
        if(data.settings){
          if(data.settings.dailyGain!==undefined)setDailyGain(data.settings.dailyGain);
          if(data.settings.tradingDays!==undefined)setTradingDays(data.settings.tradingDays);
          if(data.settings.goal!==undefined)setGoal(data.settings.goal);
        }
      }
      setLoaded(true);
    });
    return unsub;
  },[user]);

  // Debounced save to Firestore
  const saveToFirebase=useCallback((data)=>{
    if(!user)return;
    skipSync.current=true;
    if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>{saveUserData(user.uid,data).catch(console.error);},800);
  },[user]);

  // Save settings changes
  useEffect(()=>{if(loaded&&user)saveToFirebase({settings:{dailyGain,tradingDays,goal}});},[dailyGain,tradingDays,goal,loaded]);
  // Save entries changes
  useEffect(()=>{if(loaded&&user)saveToFirebase({plEntries});},[plEntries,loaded]);
  useEffect(()=>{if(loaded&&user)saveToFirebase({discLog});},[discLog,loaded]);

  // Quote rotation
  useEffect(()=>{const id=setInterval(()=>{setFadeIn(false);setTimeout(()=>{setQIdx(i=>(i+1)%QUOTES.length);setFadeIn(true);},500);},6000);return()=>clearInterval(id);},[]);

  const addPL=useCallback(entry=>setPlEntries(p=>[...p,entry]),[]);
  const resetPL=useCallback(()=>setPlEntries([]),[]);
  const addDisc=useCallback(type=>{const now=new Date();setDiscLog(p=>[...p,{type,time:now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+" · "+now.toLocaleDateString(),id:Date.now().toString(36)}]);},[]);

  // Show auth screen or loading
  if(user===undefined)return <div style={{minHeight:'100vh',background:'#0d1117',display:'flex',alignItems:'center',justifyContent:'center'}}><div className="mn" style={{color:'rgba(255,255,255,.3)',fontSize:14}}>Loading...</div></div>;
  if(user===null)return <AuthScreen/>;

  const totalDeposited=plEntries.filter(e=>e.type==="deposit").reduce((s,e)=>s+e.amount,0);
  const totalWithdrawn=plEntries.filter(e=>e.type==="withdraw").reduce((s,e)=>s+Math.abs(e.amount),0);
  const dayPnl=plEntries.filter(e=>e.type==="daytrade").reduce((s,e)=>s+e.amount,0);
  const predPnl=plEntries.filter(e=>e.type==="prediction").reduce((s,e)=>s+e.amount,0);
  const tradePnl=dayPnl+predPnl;
  const liveBal=totalDeposited-totalWithdrawn+tradePnl;
  const hasDeposit=totalDeposited>0;
  const startPt=Math.max(liveBal,1);

  // Projected: pure math from live balance
  const projData=compoundArr(startPt,dailyGain,tradingDays);
  const finalValue=projData[projData.length-1];
  const totalReturn=((finalValue-startPt)/startPt)*100;

  // Real equity: one point per unique trading day
  const tradeDates=new Set(plEntries.filter(e=>e.type==="daytrade"||e.type==="prediction").map(e=>e.date));
  const daysUsed=tradeDates.size;
  const daysRemaining=Math.max(0,tradingDays-daysUsed);

  // Build real equity by day (combined all entry types)
  const sorted=[...plEntries].sort((a,b)=>a.date<b.date?-1:1);
  const dayBuckets={};sorted.forEach(e=>{if(!dayBuckets[e.date])dayBuckets[e.date]=0;dayBuckets[e.date]+=e.amount;});
  const realEq=[totalDeposited||0];
  Object.keys(dayBuckets).sort().forEach(d=>realEq.push(realEq[realEq.length-1]+dayBuckets[d]));

  // Goal — dual analysis: projected vs actual pace
  const hitsGoal=finalValue>=goal;
  const daysToGoal=goal>startPt?projData.findIndex(v=>v>=goal):-1;
  const needed=neededPct(startPt,goal,daysRemaining);

  // Actual pace analysis
  const actualDailyAvg=daysUsed>0&&totalDeposited>0?((Math.pow(liveBal/totalDeposited,1/daysUsed)-1)*100):0;
  const actualProjected=daysUsed>0&&liveBal>0&&actualDailyAvg>0?liveBal*Math.pow(1+actualDailyAvg/100,daysRemaining):liveBal;
  const actualHitsGoal=actualProjected>=goal;
  const actualNeeded=liveBal>0&&liveBal<goal&&daysRemaining>0?neededPct(liveBal,goal,daysRemaining):0;
  const actualDaysToGoal=actualDailyAvg>0&&liveBal<goal?Math.ceil(Math.log(goal/liveBal)/Math.log(1+actualDailyAvg/100)):-1;

  const gainStep=dailyGain<5?0.1:dailyGain<50?1:5;

  return <div style={{minHeight:"100vh",background:"#0d1117",color:"#e6edf3",fontFamily:"'DM Sans',sans-serif",padding:"24px 16px"}}>

    {showGhost&&<GhostCheck onClose={()=>setShowGhost(false)} onLog={addDisc} dailyGain={dailyGain} liveBal={liveBal} entries={plEntries} compoundData={projData} finalValue={finalValue}/>}
    {showTilt&&<TiltCheck onClose={()=>setShowTilt(false)} onLog={addDisc} dailyGain={dailyGain} liveBal={liveBal} entries={plEntries}/>}
    {showPL&&<PLTracker onClose={()=>setShowPL(false)} entries={plEntries} onAdd={addPL} onReset={resetPL} liveBal={liveBal} totalDeposited={totalDeposited} tradePnl={tradePnl} dayPnl={dayPnl} predPnl={predPnl}/>}
    {showSim&&<VarSim onClose={()=>setShowSim(false)} capital={startPt} dailyGain={dailyGain}/>}
    {showLog&&<DiscLog entries={discLog} onClose={()=>setShowLog(false)}/>}

    <div style={{maxWidth:560,margin:"0 auto"}}>
      <div style={{marginBottom:32,animation:"fadeUp .6s ease-out"}}><div className="mn" style={{fontSize:11,letterSpacing:3,textTransform:"uppercase",color:"rgba(76,217,160,.6)",marginBottom:8}}>Slow &amp; Steady</div><h1 className="sf" style={{fontSize:32,fontWeight:700,margin:0,lineHeight:1.2}}>The Compound Path</h1><p style={{color:"rgba(255,255,255,.4)",fontSize:14,marginTop:8,lineHeight:1.6}}>Day trades + prediction markets. No FOMO. No revenge trades.</p></div>

      {hasDeposit&&<button onClick={()=>setShowPL(true)} style={{width:"100%",padding:"14px 20px",borderRadius:12,marginBottom:20,border:`1px solid ${tradePnl>=0?"rgba(76,217,160,.15)":"rgba(255,107,107,.15)"}`,background:tradePnl>=0?"rgba(76,217,160,.04)":"rgba(255,107,107,.04)",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",animation:"fadeUp .6s ease-out .05s both",transition:"all .2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=tradePnl>=0?"rgba(76,217,160,.3)":"rgba(255,107,107,.3)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor=tradePnl>=0?"rgba(76,217,160,.15)":"rgba(255,107,107,.15)";}}>
        <div style={{textAlign:"left"}}><div className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:1.5,textTransform:"uppercase"}}>Balance</div><div className="mn" style={{fontSize:20,fontWeight:700,color:"#e6edf3",marginTop:2}}>{fmt(liveBal)}</div></div>
        <div style={{textAlign:"center"}}><div className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:1.5,textTransform:"uppercase"}}>📈 {fmt(dayPnl)}</div><div className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:1.5,textTransform:"uppercase",marginTop:2}}>🎯 {fmt(predPnl)}</div></div>
        <div style={{textAlign:"right"}}><div className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:1.5,textTransform:"uppercase"}}>Total P&L</div><div className="mn" style={{fontSize:20,fontWeight:700,color:tradePnl>=0?"#4CD9A0":"#FF6B6B",marginTop:2}}>{tradePnl>=0?"+":""}{fmt(tradePnl)}</div></div>
      </button>}

      <div style={{padding:"20px 24px",borderRadius:12,background:"rgba(76,217,160,.04)",border:"1px solid rgba(76,217,160,.1)",marginBottom:28,minHeight:60,display:"flex",alignItems:"center"}}><p className="sf" style={{fontStyle:"italic",fontSize:16,color:"rgba(255,255,255,.7)",margin:0,lineHeight:1.5,opacity:fadeIn?1:0,transition:"opacity .5s ease"}}>"{QUOTES[qIdx]}"</p></div>

      <div style={{display:"flex",flexDirection:"column",gap:24,marginBottom:32,animation:"fadeUp .6s ease-out .2s both"}}>
        {hasDeposit&&<div style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:10,padding:"12px 16px"}}><div className="mn" style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Projecting from live balance</div><div className="mn" style={{fontSize:20,fontWeight:700,color:"#4CD9A0"}}>{fmt(startPt)}</div></div>}
        {!hasDeposit&&<p style={{fontSize:13,color:"rgba(255,255,255,.35)",textAlign:"center"}}>Log a deposit to start tracking your real balance →</p>}
        <NumSlider label="Daily Target" value={dailyGain} min={0.1} max={500} step={gainStep} suffix="%" onChange={setDailyGain}/>
        <NumSlider label="Trading Days" value={tradingDays} min={5} max={504} step={1} suffix=" days" onChange={setTradingDays}/>
        <NumSlider label="Goal" value={goal} min={100} max={1000000} step={100} suffix="$" onChange={setGoal}/>
      </div>

      {hasDeposit&&goal>0&&<div style={{borderRadius:12,marginBottom:24,animation:"fadeUp .6s ease-out .25s both",display:"flex",flexDirection:"column",gap:10}}>
        {/* Projected path status */}
        <div style={{background:hitsGoal?"rgba(76,217,160,.04)":"rgba(255,215,0,.04)",border:`1px solid ${hitsGoal?"rgba(76,217,160,.12)":"rgba(255,215,0,.12)"}`,borderRadius:12,padding:"16px 20px"}}>
          <div className="mn" style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:hitsGoal?"rgba(76,217,160,.6)":"rgba(255,215,0,.6)",marginBottom:10}}>📐 Daily Target: {dailyGain}%/day</div>
          {hitsGoal?<div style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.7}}>Your <strong style={{color:"#4CD9A0"}}>{dailyGain}%/day</strong> target <strong style={{color:"#4CD9A0"}}>hits your goal</strong> of <strong style={{color:"#FFD700"}}>{fmt(goal)}</strong>{daysToGoal>0?<> by <strong style={{color:"#e6edf3"}}>Day {daysToGoal}</strong> — {tradingDays-daysToGoal} days to spare</>:" within your timeline"}.</div>
          :<div style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.7}}>Your <strong style={{color:"#FFB347"}}>{dailyGain}%/day</strong> target <strong style={{color:"#FF6B6B"}}>falls short</strong> — it only reaches <strong style={{color:"#e6edf3"}}>{fmt(finalValue)}</strong> in {tradingDays} days. You'd need <strong style={{color:needed<=10?"#FFB347":"#FF6B6B"}}>{needed.toFixed(2)}%/day</strong> to hit <strong style={{color:"#FFD700"}}>{fmt(goal)}</strong>.</div>}
        </div>
        {/* Actual pace status — only show if they have trades */}
        {daysUsed>0&&<div style={{background:actualHitsGoal?"rgba(76,217,160,.04)":liveBal>=goal?"rgba(76,217,160,.04)":"rgba(255,107,107,.04)",border:`1px solid ${actualHitsGoal||liveBal>=goal?"rgba(76,217,160,.12)":"rgba(255,107,107,.12)"}`,borderRadius:12,padding:"16px 20px"}}>
          <div className="mn" style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:actualHitsGoal||liveBal>=goal?"rgba(76,217,160,.6)":"rgba(255,107,107,.6)",marginBottom:10}}>📊 Your Actual Pace ({daysUsed} day{daysUsed!==1?"s":""} traded)</div>
          {liveBal>=goal?<div style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.7}}>You've already <strong style={{color:"#4CD9A0"}}>hit your goal</strong>. Current balance: <strong style={{color:"#4CD9A0"}}>{fmt(liveBal)}</strong> vs goal of <strong style={{color:"#FFD700"}}>{fmt(goal)}</strong>.</div>
          :actualDailyAvg<=0?<div style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.7}}>Your actual average is <strong style={{color:"#FF6B6B"}}>{actualDailyAvg.toFixed(2)}%/day</strong> — you're <strong style={{color:"#FF6B6B"}}>losing ground</strong>. At this pace, you won't reach your goal. You need <strong style={{color:actualNeeded<=10?"#FFB347":"#FF6B6B"}}>{actualNeeded.toFixed(2)}%/day</strong> for the remaining <strong style={{color:"#e6edf3"}}>{daysRemaining} days</strong> to get back on track.</div>
          :actualHitsGoal?<div style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.7}}>You're averaging <strong style={{color:"#4CD9A0"}}>{actualDailyAvg.toFixed(2)}%/day</strong> — <strong style={{color:"#4CD9A0"}}>on track</strong> to hit <strong style={{color:"#FFD700"}}>{fmt(goal)}</strong>{actualDaysToGoal>0?<> in roughly <strong style={{color:"#e6edf3"}}>{actualDaysToGoal} more days</strong></>:""}. Projected at your pace: <strong style={{color:"#e6edf3"}}>{fmt(actualProjected)}</strong>.</div>
          :<div style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.7}}>You're averaging <strong style={{color:"#FFB347"}}>{actualDailyAvg.toFixed(2)}%/day</strong> — {actualDailyAvg<dailyGain?<><strong style={{color:"#FF6B6B"}}>below your {dailyGain}% target</strong></>:<><strong style={{color:"#4CD9A0"}}>above your target</strong> but</>} <strong style={{color:"#FF6B6B"}}>not enough to hit {fmt(goal)}</strong> in {daysRemaining} remaining days. At your current pace you'd reach <strong style={{color:"#e6edf3"}}>{fmt(actualProjected)}</strong>. You need <strong style={{color:actualNeeded<=10?"#FFB347":"#FF6B6B"}}>{actualNeeded.toFixed(2)}%/day</strong> from here.</div>}
        </div>}
      </div>}

      <div style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:16,padding:"24px 16px 16px",marginBottom:24,animation:"fadeUp .6s ease-out .3s both"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,padding:"0 8px"}}><span className="mn" style={{fontSize:12,color:"rgba(255,255,255,.35)"}}>{realEq.length>2?"PROJECTED vs ACTUAL":"GROWTH CURVE"}</span><span className="mn" style={{fontSize:12,color:"rgba(255,255,255,.35)"}}>Hover for details</span></div>
        {realEq.length>2&&<div style={{display:"flex",gap:16,justifyContent:"center",marginBottom:8,fontSize:11}}><span className="mn" style={{color:"rgba(76,217,160,.5)"}}>--- Projected ({dailyGain}%/day)</span><span className="mn" style={{color:tradePnl>=0?"#4CD9A0":"#FF6B6B"}}>● Actual (each dot = a day)</span>{goal>0&&<span className="mn" style={{color:"rgba(255,215,0,.5)"}}>--- Goal</span>}</div>}
        {/* Zoom controls */}
        <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:12}}>
          {[{k:"full",l:"Full Timeline"},{k:"goal",l:"To Goal"},{k:"actual",l:"Zoom to Actual"}].map(z=>
            <button key={z.k} onClick={()=>setChartZoom(z.k)} className="mn" style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${chartZoom===z.k?"rgba(76,217,160,.3)":"rgba(255,255,255,.08)"}`,background:chartZoom===z.k?"rgba(76,217,160,.08)":"transparent",color:chartZoom===z.k?"#4CD9A0":"rgba(255,255,255,.35)",fontSize:11,cursor:"pointer",transition:"all .2s"}}>{z.l}</button>)}
        </div>
        <div style={{cursor:"crosshair"}} onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();const zDays=chartZoom==="actual"?Math.max(realEq.length+2,10):chartZoom==="goal"&&daysToGoal>0?Math.min(daysToGoal+5,projData.length-1):projData.length-1;setHDay(Math.round(((e.clientX-r.left)/r.width)*zDays));}} onMouseLeave={()=>setHDay(null)} onTouchMove={e=>{const r=e.currentTarget.getBoundingClientRect();const zDays=chartZoom==="actual"?Math.max(realEq.length+2,10):chartZoom==="goal"&&daysToGoal>0?Math.min(daysToGoal+5,projData.length-1):projData.length-1;setHDay(Math.max(0,Math.min(zDays,Math.round(((e.touches[0].clientX-r.left)/r.width)*zDays))));}}>
          <GrowthChart projData={projData} hDay={hDay} realData={realEq.length>2?realEq:undefined} goalLine={goal>0?goal:0}
            maxDay={chartZoom==="actual"?Math.max(realEq.length+2,10):chartZoom==="goal"&&daysToGoal>0?Math.min(daysToGoal+5,projData.length-1):undefined}
            maxVal={chartZoom==="actual"?Math.max(...realEq)*1.5:chartZoom==="goal"?goal*1.3:undefined}/>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:32,animation:"fadeUp .6s ease-out .4s both"}}>
        {[{l:"Projected Value",v:fmt(finalValue),a:true},{l:"Total Return",v:totalReturn>99999?`${(totalReturn/1000).toFixed(0)}K%`:`${totalReturn.toFixed(0)}%`,a:true},{l:"Days Used",v:`${daysUsed} of ${tradingDays}`},{l:"Days Remaining",v:`${daysRemaining}`}].map((s,i)=><div key={i} style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:12,padding:"16px 20px"}}><div className="mn" style={{fontSize:11,color:"rgba(255,255,255,.35)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:6}}>{s.l}</div><div className="mn" style={{fontSize:22,fontWeight:700,color:s.a?"#4CD9A0":"#e6edf3"}}>{s.v}</div></div>)}
      </div>

      <div style={{background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.06)",borderRadius:16,padding:24,marginBottom:32,animation:"fadeUp .6s ease-out .5s both"}}><div className="mn" style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"rgba(255,255,255,.35)",marginBottom:16}}>Perspective Check</div><div style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.8}}>
        {tradePnl<0&&hasDeposit?<>You're down <strong style={{color:"#FF6B6B"}}>{fmt(Math.abs(tradePnl))}</strong> from your deposits. Your balance is <strong style={{color:"#e6edf3"}}>{fmt(liveBal)}</strong>. At <strong style={{color:"#4CD9A0"}}>{dailyGain}%</strong>, your next trade only needs to make <strong style={{color:"#e6edf3"}}>{fmt(startPt*dailyGain/100)}</strong>. Don't try to win it all back at once — that's how you dig a deeper hole.<br/><br/>At your target rate, you'd recover that <strong style={{color:"#e6edf3"}}>{fmt(Math.abs(tradePnl))}</strong> in roughly <strong style={{color:"#e6edf3"}}>{Math.ceil(Math.log((totalDeposited-totalWithdrawn)/liveBal)/Math.log(1+dailyGain/100))} disciplined days</strong>.</>
        :<>At <strong style={{color:"#4CD9A0"}}>{dailyGain}%</strong> per day, your next trade only needs to make <strong style={{color:"#e6edf3"}}>{fmt(startPt*dailyGain/100)}</strong>. That's it. No heroics.<br/><br/>By Day 30, your daily target grows to <strong style={{color:"#e6edf3"}}>{fmt(projData[Math.min(30,projData.length-1)]*dailyGain/100)}</strong> — your capital does the heavy lifting.</>}
      </div></div>

      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:32,animation:"fadeUp .6s ease-out .6s both"}}>
        <ActBtn icon="📊" label="Log Trade / View P&L" color="76,217,160" onClick={()=>setShowPL(true)}/>
        <ActBtn icon="👻" label="Am I Chasing a Ghost Trade?" color="255,107,107" pulse ghostFloat onClick={()=>setShowGhost(true)}/>
        <ActBtn icon="🔥" label="Am I Chasing Losses?" color="255,179,71" onClick={()=>setShowTilt(true)}/>
        <ActBtn icon="🎲" label="Simulate: Reality vs Discipline" color="147,130,255" onClick={()=>setShowSim(true)}/>
        <p style={{fontSize:12,color:"rgba(255,255,255,.2)",textAlign:"center",marginTop:-4}}>Run a checkpoint before any trade that feels urgent or emotional.</p>
        {discLog.length>0&&<button onClick={()=>setShowLog(true)} style={{padding:"12px 20px",borderRadius:10,border:"1px solid rgba(255,255,255,.06)",background:"rgba(255,255,255,.02)",color:"rgba(255,255,255,.5)",fontSize:13,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}} onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,.12)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,.06)";}}>🪦 Discipline Log ({discLog.length} avoided)</button>}
      </div>
      <div className="mn" style={{textAlign:"center",fontSize:11,color:"rgba(255,255,255,.15)",paddingBottom:20}}>Compounding assumes reinvested gains with no losses.<br/>Past performance does not guarantee future results.<br/><br/><button onClick={()=>signOut(auth)} style={{background:"none",border:"none",color:"rgba(255,255,255,.15)",fontSize:11,cursor:"pointer",fontFamily:"'DM Mono',monospace",textDecoration:"underline"}}>Sign Out</button></div>
    </div>
  </div>;
}
