import {FT,CABIN_ID,ICONS,SETS,STEPS,SOURCES,freshProject,validateProject,envelope,layout,review,viewProject,tutorAnswer,filterIcons,individualCabin} from './village-core.js?v=20260912-village-4';
import {createStudioView} from './studio-view.js?v=20260912-village-4';
const $=id=>document.getElementById(id), KEY='iconic-tutor-village-v1';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let asset,p,libraryIcons=[...ICONS],selected=null,view=null,mode='plan',navigationMode='pan',camera=null,drag=null,history=[],future=[];
const copy=()=>structuredClone(p);
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(p));}catch{notice('Browser storage is unavailable. Use Save project to keep your layout.',true);}}
function commit(next,{fit=false}={}){validateProject(next,asset);history.push(copy());history=history.slice(-40);future=[];p=next;persist();render(fit);}
function update(fn,options){try{const n=copy();fn(n);commit(n,options);return true;}catch(e){notice(e.message,true);render();return false;}}
function select(id){selected=id;renderSelection();renderPlan();view?.select(id);}
function fitCamera(){camera=[-8,-8,p.site.width+16,p.site.depth+16];}
function planSvg(exporting=false){
  const issues=review(p,asset), bad=new Set([...issues.outside,...issues.overlaps.flat()]);
  const cabins=p.instances.map((i,n)=>{
    const a=envelope(i,asset), angle=i.rotation*Math.PI/180;
    // Source front is negative Y. SVG north points upward.
    const fx=i.x+Math.sin(angle)*(asset.bounds[4]/FT/2),fy=p.site.depth-i.y+Math.cos(angle)*(asset.bounds[4]/FT/2);
    return `<g data-cabin="${esc(i.id)}" tabindex="0" role="button" aria-label="Cabin ${n+1}, two stories" style="cursor:grab"><rect x="${a.x}" y="${p.site.depth-a.y-a.d}" width="${a.w}" height="${a.d}" rx=".5" fill="${bad.has(n+1)?'#ecd4bf':selected===i.id?'#dbe8ae':'#e1e7d3'}" stroke="${selected===i.id?'#41622b':'#7e8a69'}" stroke-width="${selected===i.id?.6:.25}"/><path d="M ${a.x+.8} ${p.site.depth-i.y} h ${a.w-1.6}" stroke="#8b987c" stroke-width=".15"/><text x="${i.x}" y="${p.site.depth-i.y-1}" text-anchor="middle" font-size="2.6" fill="#31472e" font-family="sans-serif">${String(n+1).padStart(2,'0')}</text><text x="${i.x}" y="${p.site.depth-i.y+2}" text-anchor="middle" font-size="1.6" fill="#526249" font-family="sans-serif">2 stories</text><path d="M -1.2 -.7 L 1.2 -.7 L 0 1.1 Z" transform="translate(${fx} ${fy}) rotate(${-i.rotation})" fill="#5c7141"/></g>`;
  }).join('');
  const c=exporting?[-8,-8,p.site.width+16,p.site.depth+22]:camera;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${c.join(' ')}" aria-label="${esc(p.name)} site plan"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 H 0 V 10" fill="none" stroke="#dbe1d1" stroke-width=".12"/></pattern></defs><rect x="0" y="0" width="${p.site.width}" height="${p.site.depth}" fill="#f3f5eb" stroke="#94a382" stroke-width=".35"/><rect width="${p.site.width}" height="${p.site.depth}" fill="url(#grid)"/><text x="0" y="-3" font-size="2.2" fill="#526249">${esc(p.name)} · ${p.instances.length}/12 two-story cabins</text><text x="${p.site.width}" y="-3" text-anchor="end" font-size="2.3" fill="#526249">N ↑</text>${cabins}<text x="${p.site.width/2}" y="${p.site.depth+4}" text-anchor="middle" font-size="2.2" fill="#526249">${p.site.width} × ${p.site.depth} ft · full cabin envelopes · front = triangle</text>${exporting?`<text x="0" y="${p.site.depth+9}" font-size="1.8" fill="#526249">Concept layout · source CAD ${asset.source_revision.slice(0,12)} · engineering review pending</text>`:''}</svg>`;
}
function renderPlan(){if(!camera)fitCamera();$('plan').innerHTML=planSvg();}
function renderPalette(){
  const set=$('palette-set').value,q=$('search').value.trim().toLowerCase();
  $('palette').replaceChildren();
  if(['all','vcs','housing'].includes(set)&&(!q||'two-story campus cabin seed eco-home'.includes(q))){
    const b=document.createElement('button');b.className='icon-card cabin';b.id='cabin-icon';b.disabled=p.instances.length>=12;
    b.innerHTML='<img src="data/village/wiki-cabin.png" alt=""><span><strong>Two-story campus cabin</strong><small>Source CAD · place in village +</small></span>';
    if(b.disabled)b.querySelector('small').textContent='All 12 placed · remove one to add';
    b.onclick=addCabin;$('palette').append(b);
  }
  const icons=filterIcons(libraryIcons,set,q);
  for(const i of icons){
    const b=document.createElement('button');b.className='icon-card';b.disabled=true;b.title=`${i.name} — not available for placement yet`;
    b.innerHTML=`${i.image?`<img src="${esc(i.image)}" alt="" loading="lazy" width="120" height="120">`:`<span aria-hidden="true" class="sprite" style="background-position:${(i.index%8)/7*100}% ${Math.floor(i.index/8)/3*100}%"></span>`}<span>${esc(i.name)}<small>${i.id?esc(i.id)+' · ':''}Not available yet</small></span>`;
    if(i.id)b.dataset.registryId=i.id;
    if(i.source_url)b.title+=`\n${i.id} · ${i.wiki_target}\n${i.source_url}`;
    $('palette').append(b);
  }
  $('palette-count').textContent=`${icons.length} of ${libraryIcons.length} reference icons · 1 placeable cabin in library`;
  if(!$('palette').children.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No matching icons in this set. Try All library icons or another search.';$('palette').append(empty);}
}
function renderSelection(){
  const i=p.instances.find(i=>i.id===selected);
  if(!i){$('selection').innerHTML='<span>Select a cabin to move or rotate it.</span>';return;}
  $('selection').innerHTML=`<strong>Cabin ${p.instances.indexOf(i)+1}</strong><label>East (ft)<input id="pos-x" type="number" step="1" value="${Number(i.x.toFixed(2))}"></label><label>North (ft)<input id="pos-y" type="number" step="1" value="${Number(i.y.toFixed(2))}"></label><button id="rotate">Rotate · ${i.rotation}°</button><button id="remove">Remove</button>`;
  for(const axis of ['x','y'])$(`pos-${axis}`).onchange=e=>update(n=>{n.instances.find(j=>j.id===selected)[axis]=Number(e.target.value);});
  $('rotate').onclick=rotate;$('remove').onclick=()=>update(n=>{n.instances=n.instances.filter(j=>j.id!==selected);selected=null;});
}
function renderChecks(){
  const r=review(p,asset);
  $('review-summary').textContent=`· ${r.outside.length+r.overlaps.length+r.close.length} flags`;
  const rows=[`${r.count}/12 cabins placed · 2 stories per cabin`,
    r.outside.length?`Outside site: cabin ${r.outside.join(', ')}`:'All cabin envelopes inside site',
    r.overlaps.length?`Overlapping pairs: ${r.overlaps.map(a=>a.join(' & ')).join('; ')}`:'No overlapping cabin envelopes',
    r.close.length?`Below ${p.gap} ft planning clearance: ${r.close.map(a=>a.join(' & ')).join('; ')}`:`All pairs meet your ${p.gap} ft planning clearance`,
    p.shared.trim()?'Shared-space notes recorded':'Shared-space plan still to be described'];
  $('checks').innerHTML=`<ul>${rows.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`;
}
function renderChat(){
  $('chat-log').replaceChildren();
  for(const m of p.conversation){const div=document.createElement('div');div.className='chat-message'+(m.role==='user'?' user':'');const label=document.createElement('strong');label.textContent=m.role==='user'?'YOU':'VILLAGE GUIDE';div.append(label,document.createTextNode(m.content));$('chat-log').append(div);}
  $('chat-log').scrollTop=$('chat-log').scrollHeight;
}
function render(fit=false){
  if(fit)fitCamera();
  $('name').value=p.name;$('site-width').value=p.site.width;$('site-depth').value=p.site.depth;$('gap').value=p.gap;
  $('site-notes').value=p.notes;$('shared-notes').value=p.shared;$('palette-set').value=p.palette;
  $('count').textContent=`${p.instances.length} / 12 cabins`;$('add').disabled=p.instances.length>=12;
  $('undo').disabled=!history.length;$('redo').disabled=!future.length;
  $('step-title').textContent=STEPS[p.step].title;$('step-text').textContent=STEPS[p.step].text;
  $('next').textContent=p.step===3?'Review my layout':'Continue →';
  $('steps').innerHTML=STEPS.map((s,i)=>`<button data-step="${i}" aria-label="Step ${i+1}: ${s.title}" ${i===p.step?'aria-current="step"':''}>${i+1}</button>`).join('');
  $('steps').querySelectorAll('button').forEach(b=>b.onclick=()=>goStep(Number(b.dataset.step)));
  renderPalette();renderPlan();renderSelection();renderChecks();renderChat();
  if(view&&mode==='3d')view.render(viewProject(p,asset),selected,{fitView:fit});
}
function goStep(step){update(n=>{n.step=step;n.palette=STEPS[step].set;});}
function addCabin(){
  const added=update(n=>{const cabin=individualCabin(n,asset);n.instances.push(cabin);selected=cabin.id;},{fit:true});
  if(added)notice(`Cabin ${p.instances.length} placed and selected. ${mode==='3d'?'Use Site plan to drag the cabin, or edit its East/North coordinates below.':'Drag it to refine its position.'}`);
}
function renderNavigation(){
  $('navigation-3d').hidden=mode!=='3d';
  $('pan-view').setAttribute('aria-pressed',String(navigationMode==='pan'));
  $('orbit-view').setAttribute('aria-pressed',String(navigationMode==='orbit'));
  $('view-units').textContent=mode==='3d'?'3D · source cabin geometry':'Feet · north ↑ · triangle = porch/front';
  $('view-help').textContent=mode==='3d'?`Drag to ${navigationMode} · scroll or pinch to zoom`:'Drag cabin to place · drag background to pan · scroll to zoom';
  if(view && typeof view.setNavigationMode==='function')view.setNavigationMode(navigationMode);
  else if(view){
    // An older cached viewer can still render and orbit. Do not call a missing
    // method or misreport a script-version mismatch as missing WebGL support.
    $('pan-view').disabled=true;$('orbit-view').setAttribute('aria-pressed','true');
    $('pan-view').setAttribute('aria-pressed','false');
    $('view-help').textContent='Drag to orbit · scroll to zoom · reload for pan controls';
  }
}
function rotate(){update(n=>{const i=n.instances.find(i=>i.id===selected);if(i)i.rotation=(i.rotation+90)%360;});}
function addChat(role,content){p.conversation.push({role,content});p.conversation=p.conversation.slice(-30);persist();renderChat();}
function ask(text){
  addChat('user',text);const answer=tutorAnswer(text,p,asset);
  if(answer.palette){p.palette=answer.palette;$('palette-set').value=answer.palette;$('search').value='';renderPalette();}
  addChat('assistant',answer.reply);persist();
}
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function point(e){const svg=$('plan').querySelector('svg');return new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());}
function cancelDrag(){if(!drag)return;drag=null;renderPlan();}
function wire(){
  $('palette-set').onchange=e=>{p.palette=e.target.value;persist();renderPalette();};$('search').oninput=renderPalette;
  $('add').onclick=addCabin;
  for(const pattern of ['courtyard','rows'])$(pattern).onclick=()=>{commit(layout(p,asset,pattern),{fit:true});notice('Twelve source cabins arranged. Drag to refine; Undo restores the previous layout.');};
  $('name').onchange=e=>update(n=>{n.name=e.target.value.trim();});
  for(const key of ['width','depth'])$(`site-${key}`).onchange=e=>update(n=>{n.site[key]=Number(e.target.value);},{fit:true});
  $('gap').onchange=e=>update(n=>{n.gap=Number(e.target.value);});
  $('site-notes').onchange=e=>update(n=>{n.notes=e.target.value;});$('shared-notes').onchange=e=>update(n=>{n.shared=e.target.value;});
  $('next').onclick=()=>{
    if(p.step===1&&p.instances.length!==12){notice('Place all twelve cabins before continuing, or use an arrangement button.',true);return;}
    if(p.step===2&&!p.shared.trim()){notice('Describe your shared-space plan before continuing.',true);$('shared-notes').focus();return;}
    if(p.step===3){ask('Check my layout');$('checks').parentElement.open=true;}else goStep(p.step+1);
  };
  $('undo').onclick=()=>{if(!history.length)return;future.push(copy());p=history.pop();persist();render();};
  $('redo').onclick=()=>{if(!future.length)return;history.push(copy());p=future.pop();persist();render();};
  $('fit').onclick=()=>{fitCamera();renderPlan();view?.fit();};
  $('tab-plan').onclick=()=>{mode='plan';$('plan').hidden=false;$('village-3d').hidden=true;$('tab-plan').setAttribute('aria-pressed','true');$('tab-3d').setAttribute('aria-pressed','false');renderNavigation();};
  $('tab-3d').onclick=()=>{
    try{mode='3d';$('plan').hidden=true;$('village-3d').hidden=false;$('tab-plan').setAttribute('aria-pressed','false');$('tab-3d').setAttribute('aria-pressed','true');
      if(!view)view=createStudioView($('village-3d'),select);
      renderNavigation();
      view.render(viewProject(p,asset),selected,{fitView:true});
    }catch(e){console.error('Village 3D view could not open:',e);$('tab-plan').click();notice(`The 3D view could not open: ${e.message}. Reload the page to try again; your layout is saved.`,true);}
  };
  $('pan-view').onclick=()=>{navigationMode='pan';renderNavigation();};
  $('orbit-view').onclick=()=>{navigationMode='orbit';renderNavigation();};
  $('save').onclick=()=>download(JSON.stringify(p,null,2)+'\n','iconic-village.json','application/json');
  $('export').onclick=()=>download(planSvg(true),'iconic-village-plan.svg','image/svg+xml');
  $('open').onclick=()=>$('file').click();
  $('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>250000)throw Error('Village project files must be under 250 KB.');const next=validateProject(JSON.parse(await f.text()),asset);commit(next,{fit:true});selected=null;renderSelection();notice('Village project opened.');}catch(e){notice(e.message+' Your current layout is retained.',true);}finally{$('file').value='';}};
  $('chat-form').onsubmit=e=>{e.preventDefault();const text=$('question').value.trim();if(!text)return;$('question').value='';ask(text);};
  document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>ask(b.dataset.question));
  $('plan').addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const group=e.target.closest('[data-cabin]'),start=point(e);
    if(group){selected=group.dataset.cabin;renderSelection();view?.select(selected);const i=p.instances.find(i=>i.id===selected);drag={id:selected,start,original:{...i},pointer:e.pointerId};}
    else drag={start,camera:[...camera],pointer:e.pointerId};
    $('plan').setPointerCapture(e.pointerId);$('plan').focus();e.preventDefault();
  });
  $('plan').addEventListener('pointermove',e=>{
    if(!drag||drag.pointer!==e.pointerId)return;
    const pt=point(e);
    if(drag.id){const dx=pt.x-drag.start.x,dy=pt.y-drag.start.y;drag.delta=[dx,dy];$('plan').querySelector(`[data-cabin="${drag.id}"]`)?.setAttribute('transform',`translate(${dx} ${dy})`);}
    else{const dx=pt.x-drag.start.x,dy=pt.y-drag.start.y;camera[0]-=dx;camera[1]-=dy;$('plan').querySelector('svg').setAttribute('viewBox',camera.join(' '));}
  });
  $('plan').addEventListener('pointerup',e=>{
    if(!drag||drag.pointer!==e.pointerId)return;const d=drag;drag=null;
    if(d.id&&d.delta){update(n=>{const i=n.instances.find(i=>i.id===d.id);i.x=Math.round((d.original.x+d.delta[0])*2)/2;i.y=Math.round((d.original.y-d.delta[1])*2)/2;});}
    else renderPlan();
  });
  $('plan').addEventListener('pointercancel',()=>{if(drag?.camera)camera=drag.camera;cancelDrag();});
  window.addEventListener('blur',cancelDrag);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(drag?.camera)camera=drag.camera;cancelDrag();}});
  $('plan').addEventListener('keydown',e=>{
    const id=e.target.closest('[data-cabin]')?.dataset.cabin;if(id)selected=id;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();select(selected);return;}
    if(!selected||!p.instances.some(i=>i.id===selected))return;
    if(e.key.toLowerCase()==='r'){e.preventDefault();rotate();return;}
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[e.key];
    if(delta){e.preventDefault();update(n=>{const i=n.instances.find(i=>i.id===selected);i.x+=delta[0];i.y+=delta[1];});}
  });
  $('plan').addEventListener('wheel',e=>{e.preventDefault();const pt=point(e),scale=e.deltaY>0?1.12:1/1.12;if(camera[2]*scale<20||camera[2]*scale>4000)return;camera=[pt.x+(camera[0]-pt.x)*scale,pt.y+(camera[1]-pt.y)*scale,camera[2]*scale,camera[3]*scale];$('plan').querySelector('svg').setAttribute('viewBox',camera.join(' '));},{passive:false});
}
async function boot(){
  try{
    const [res,registryRes]=await Promise.all([fetch('data/village/cabin.json'),fetch('data/village/ichl-registry.json')]);
    if(!res.ok||!registryRes.ok)throw Error('Village library could not be loaded.');
    asset=await res.json();const registry=await registryRes.json();libraryIcons=[...ICONS,...registry.icons];p=freshProject(asset);
    let restoreError='';try{const saved=localStorage.getItem(KEY);if(saved)p=validateProject(JSON.parse(saved),asset);}catch{restoreError='Saved village could not be restored. A fresh layout is open; use Open project for a saved file.';}
    $('palette-set').innerHTML=Object.entries(SETS).map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
    $('dimensions').textContent=`Full envelope: ${(asset.bounds[3]/FT).toFixed(2)} × ${(asset.bounds[4]/FT).toFixed(2)} ft; ${(asset.bounds[5]/FT).toFixed(2)} ft high. Nominal 12×12 VCS modules differ from this specific 13×13 implementation.`;
    $('sources').innerHTML=SOURCES.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>`).join('');
    wire();render(true);
    if(!p.conversation.length)addChat('assistant','Let’s design a village of twelve two-story cabins. Begin with the site, then try a courtyard or rows. I’ll help you check placement and think through shared spaces. Ask me to show any icon set as you need it.');
    notice(restoreError||'Source cabin loaded. Set up your site to begin.',!!restoreError);
  }catch(e){notice(e.message,true);document.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);}
}
boot();
