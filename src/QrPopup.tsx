import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './QrPopup.css';
export function QrPopup({src,room,url}:{src:string;room:string;url:string}) {
  const [open,setOpen] = useState(false); const [size,setSize] = useState(360);
  const ref = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  useEffect(()=>{ if (!open) return; ref.current?.showModal(); return ()=>{ trigger.current?.focus(); }; },[open]);
  return <><button ref={trigger} className="audit-qr-button" aria-label="학생 입장 QR 크게 보기" onClick={()=>setOpen(true)}><img src={src} alt={`방 ${room} 학생 입장 QR코드`} /></button>
  {open && createPortal(<dialog ref={ref} className="audit-qr-dialog" aria-label="학생 입장 · 다시 접속 QR" style={{width:`min(${size+90}px,calc(100vw - 32px))`}} onClose={()=>setOpen(false)} onCancel={()=>setOpen(false)} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setOpen(false);}}>
  <button className="audit-qr-close" aria-label="QR 닫기" onClick={()=>setOpen(false)}>×</button><h2>학생 입장 · 다시 접속</h2>
  <img className="audit-qr-big" src={src} alt="학생 입장 QR 코드" style={{width:`min(${size}px,74vw,calc(100dvh - 260px))`}} />
  <div className="audit-qr-size"><button aria-label="QR 축소" disabled={size<=180} onClick={()=>setSize(Math.max(180,size-60))}>−</button><label>QR 크기 <output>{size}px</output><input type="range" aria-label="QR 크기" min="180" max="720" step="20" value={size} onChange={e=>setSize(Number(e.target.value))}/></label><button aria-label="QR 확대" disabled={size>=720} onClick={()=>setSize(Math.min(720,size+60))}>+</button></div>
  <p>방 코드 <b>{room}</b></p><p>같은 기기·브라우저에서 원래 이름으로 다시 입장하면 기존 자리를 이어가요.</p><button onClick={()=>void navigator.clipboard.writeText(url).catch(()=>window.prompt('입장 링크',url))}>입장 링크 복사</button></dialog>,document.body)}</>;
}
