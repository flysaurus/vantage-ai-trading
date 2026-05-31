'use client';
import { useState, useEffect } from 'react';

interface SplashScreenProps { onComplete: () => void; }

const PATHS: Record<string, number> = {
  'fox-head':260, 'fox-ear-left':80, 'fox-ear-right':80,
  'fox-eye-left':25, 'fox-eye-right':25, 'fox-nose':30, 'chart-line':210,
};
const DRAWS: Record<string, number> = {
  'fox-head':0, 'fox-ear-left':.15, 'fox-ear-right':.3,
  'fox-eye-left':.55, 'fox-eye-right':.7, 'fox-nose':.85,
};
const VANTAGE = 'VANTAGE'.split('');

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [p, setP] = useState(0);
  const [skip, setSkip] = useState(false);
  const [tp, setTp] = useState<'idle'|'vantage'|'subtitle'|'done'>('idle');
  useEffect(() => {
    const t = [50,1500,2200,2800,3400].map((ms,i) =>
      setTimeout(() => { setP(i+1); if(i===3) setTp('vantage'); }, ms));
    const tDone = setTimeout(onComplete, 4000);
    return () => [...t, tDone].forEach(clearTimeout);
  }, [onComplete]);
  useEffect(() => { const t = setTimeout(() => setSkip(true), 1000); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (tp==='vantage') { const t=setTimeout(()=>setTp('subtitle'), VANTAGE.length*80+200); return ()=>clearTimeout(t); }
    if (tp==='subtitle') { const t=setTimeout(()=>setTp('done'), 600); return ()=>clearTimeout(t); }
  }, [tp]);
  const ph = (n:number) => p>=n;
  return (
    <div style={{
      position:'fixed',inset:0,zIndex:9999,background:'#000',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      height:'100dvh',fontFamily:'system-ui,-apple-system,sans-serif',
      opacity:ph(5)?0:1,transition:'opacity .6s ease-in-out',pointerEvents:ph(5)?'none':'auto',
    }}>
      <style>{`
        @keyframes dP { to{stroke-dashoffset:0} }
        @keyframes fG { 0%,100%{filter:drop-shadow(0 0 8px #06B6D4)} 50%{filter:drop-shadow(0 0 20px #06B6D4) drop-shadow(0 0 40px #06B6D4)} }
        @keyframes fL { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fI { from{opacity:0} to{opacity:1} }
        .draw .fp,.draw .fe,.draw .fn{stroke-dasharray:var(--l);stroke-dashoffset:var(--l);animation:dP .6s ease-in-out forwards;animation-delay:var(--d)}
        .draw .fe,.draw .fn{stroke:none}
        .glow .fox-wrap{animation:fG .7s ease-in-out 1 forwards}
        .chart .cl{stroke-dasharray:var(--l);stroke-dashoffset:var(--l);animation:dP .6s ease-in-out forwards}
        .li{opacity:0;animation:fL .3s ease-out forwards}
        .si{opacity:0;animation:fI .5s ease-out forwards}
        .sk{animation:fI .5s ease-out}
      `}</style>
      <div className={ph(2)?'glow':''} style={{marginBottom:12}}>
        <svg viewBox="0 0 120 120" width="120" height="120"
          className={`fox-wrap ${ph(1)?'draw':''}`}
          style={{filter:ph(1)?'drop-shadow(0 0 8px #06B6D4)':undefined}}>
          <circle cx="60" cy="55" r="45" fill="none" stroke="#06B6D4" strokeWidth=".5"
            opacity={ph(1)?.15:0} style={{transition:'opacity .5s'}} />
          {[
            ['M60 10 L95 35 L95 85 L60 100 L25 85 L25 35 Z','fp','fox-head'],
            ['M25 35 L10 10 L40 25','fp','fox-ear-left'],
            ['M95 35 L110 10 L80 25','fp','fox-ear-right'],
          ].map(([d,cls,id]) => (
            <path key={id} d={d} fill="none" stroke="#06B6D4" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" className={cls}
              style={{'--l':PATHS[id],'--d':`${DRAWS[id]}s`} as React.CSSProperties} />
          ))}
          {[[45,55,'fox-eye-left'],[75,55,'fox-eye-right']].map(([cx,cy,id]) => (
            <circle key={id} cx={cx} cy={cy} r="4"
              fill={ph(1)?'#06B6D4':'none'} stroke="#06B6D4" strokeWidth="2" className="fe"
              style={{'--l':PATHS[id],'--d':`${DRAWS[id]}s`,transition:'fill .3s ease-in-out',
                transitionDelay:ph(2)?'.2s':'0s'} as React.CSSProperties} />
          ))}
          <path d="M55 72 L60 78 L65 72 Z"
            fill={ph(1)?'#06B6D4':'none'} stroke="#06B6D4" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" className="fn"
            style={{'--l':PATHS['fox-nose'],'--d':`${DRAWS['fox-nose']}s`,
              transition:'fill .2s ease-in-out',transitionDelay:ph(2)?'.4s':'0s'} as React.CSSProperties} />
        </svg>
      </div>
      <div style={{width:200,height:50,marginTop:8}}>
        <svg viewBox="0 0 200 50" width="200" height="50" className={ph(3)?'chart':''}>
          <path d="M0 30 L60 32 L90 35 L130 20 L170 8 L200 5"
            fill="none" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" className="cl"
            opacity={ph(3)?1:0}
            style={{'--l':PATHS['chart-line'],transition:'opacity .1s'} as React.CSSProperties} />
        </svg>
      </div>
      <div style={{marginTop:16,textAlign:'center'}}>
        <div style={{fontSize:32,fontWeight:200,letterSpacing:'.3em',color:'#fff',marginBottom:10,minHeight:42}}>
          {tp!=='idle'&&VANTAGE.map((l,i)=>(
            <span key={i} className="li" style={{animationDelay:`${i*.08}s`,display:'inline-block'}}>{l}</span>
          ))}
        </div>
        <div style={{fontSize:13,fontWeight:300,letterSpacing:'.2em',color:'rgba(255,255,255,.5)',minHeight:20}}>
          {(tp==='subtitle'||tp==='done')&&<span className="si">AI Trading Intelligence</span>}
        </div>
      </div>
      {skip&&<button onClick={onComplete} className="sk" style={{
        position:'absolute',bottom:32,left:'50%',transform:'translateX(-50%)',
        background:'none',border:'none',color:'rgba(255,255,255,.3)',fontSize:11,
        letterSpacing:'.2em',fontWeight:400,cursor:'pointer',fontFamily:'inherit',
        textTransform:'uppercase'}}>Skip</button>}
    </div>
  );
}
