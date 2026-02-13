import { auth, googleProvider } from './firebase';
import { signInWithPopup } from 'firebase/auth';

export default function AuthScreen() {
  const handleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) { console.error('Login failed:', e); alert('Login failed. Make sure your domain is in Firebase Authorized Domains.'); }
  };
  return (
    <div style={{minHeight:'100vh',background:'#0d1117',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center',fontFamily:"'DM Sans',sans-serif"}}>
      <div className="mn" style={{fontSize:11,letterSpacing:3,textTransform:'uppercase',color:'rgba(76,217,160,.6)',marginBottom:8}}>Slow & Steady</div>
      <h1 className="sf" style={{fontSize:36,fontWeight:700,color:'#e6edf3',margin:'0 0 12px'}}>The Compound Path</h1>
      <p style={{color:'rgba(255,255,255,.4)',fontSize:15,marginBottom:40,maxWidth:360,lineHeight:1.6}}>Day trades + prediction markets. No FOMO. No revenge trades.</p>
      <button onClick={handleLogin} style={{padding:'16px 40px',borderRadius:12,border:'1px solid rgba(76,217,160,.3)',background:'rgba(76,217,160,.06)',color:'#4CD9A0',fontSize:16,fontFamily:"'DM Sans',sans-serif",fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:12,transition:'all .3s'}}
        onMouseEnter={e=>{e.currentTarget.style.background='rgba(76,217,160,.12)';}}
        onMouseLeave={e=>{e.currentTarget.style.background='rgba(76,217,160,.06)';}}>
        Sign in with Google
      </button>
      <p style={{color:'rgba(255,255,255,.2)',fontSize:12,marginTop:16}}>Your data syncs across all your devices.</p>
    </div>
  );
}
