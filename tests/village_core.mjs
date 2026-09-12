import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ICONS,FT,freshProject,validateProject,layout,review,envelope,viewProject,tutorAnswer,filterIcons,SETS,individualCabin} from '../web/js/village-core.js';
const asset=JSON.parse(fs.readFileSync(new URL('../web/data/village/cabin.json',import.meta.url)));
const p=freshProject(asset);
assert.equal(ICONS.length,31);assert(ICONS.every(i=>!i.available));
const registry=JSON.parse(fs.readFileSync(new URL('../web/data/village/ichl-registry.json',import.meta.url)));
assert.equal(registry.icons.length,301);assert.equal(new Set(registry.icons.map(i=>i.id)).size,301);
for(const i of registry.icons){assert.equal(i.available,false);assert(i.sets.every(s=>Object.hasOwn(SETS,s)));assert(fs.existsSync(new URL('../web/'+i.image,import.meta.url)));assert(i.source_url.startsWith('https://wiki.opensourceecology.org/wiki/'));}
const combined=[...ICONS,...registry.icons];assert.equal(filterIcons(combined,'all').length,332);assert.equal(filterIcons(combined,'ichl').length,301);assert.equal(filterIcons(combined,'vcs').length,31);
const mailbox=filterIcons(combined,'ichl','ICHL-301');assert.equal(mailbox.length,1);assert.equal(mailbox[0].image_file,'302_Mailbox_with_Address.webp');
assert(filterIcons(combined,'framing','wall').length>0);assert.equal(filterIcons(combined,'all','not-a-real-icon').length,0);
assert.equal(asset.stories,2);assert(asset.bounds[5]>6000);assert(asset.parts.length>20);
for(const pattern of ['rows','courtyard']){
  const n=layout(p,asset,pattern),r=review(n,asset);
  assert.equal(n.instances.length,12);assert.equal(new Set(n.instances.map(i=>i.id)).size,12);
  assert.deepEqual(r,{count:12,outside:[],overlaps:[],close:[]},pattern);
  assert.deepEqual(validateProject(n,asset),n);
  const scene=viewProject(n,asset);
  for(const [index,i] of n.instances.entries()){
    const a=envelope(i,asset), inst=scene.instances[index],r=i.rotation*Math.PI/180;
    // Independently project all four CAD corners and compare with plan envelope.
    const corners=[[0,0],[asset.bounds[3],0],[0,asset.bounds[4]],[asset.bounds[3],asset.bounds[4]]].map(([x,y])=>[(inst.position[0]+Math.cos(r)*x-Math.sin(r)*y)/FT,(inst.position[1]+Math.sin(r)*x+Math.cos(r)*y)/FT]);
    assert(Math.abs(Math.min(...corners.map(c=>c[0]))-a.x)<1e-8);
    assert(Math.abs(Math.max(...corners.map(c=>c[1]))-a.y-a.d)<1e-8);
  }
}
const collision=layout(p,asset,'rows');collision.instances[1]={...collision.instances[0],id:'cabin-other'};
assert(review(collision,asset).overlaps.length);collision.instances[0].x=-10;assert(review(collision,asset).outside.length);
for(const mutate of [p=>p.site.width=NaN,p=>p.gap=-1,p=>p.instances[0].rotation=45,p=>p.instances[0].id=p.instances[1].id,p=>p.source_revision='other',p=>p.conversation=[{role:'system',content:'x'}]]){const n=layout(p,asset,'rows');mutate(n);assert.throws(()=>validateProject(n,asset));}
assert.equal(tutorAnswer('Show energy icons',p,asset).palette,'energy');
assert.equal(tutorAnswer('Show all icons',p,asset).palette,'all');
assert.equal(tutorAnswer('Show 301 ICHL icons',p,asset).palette,'ichl');
assert.equal(tutorAnswer('Show framing icons',p,asset).palette,'framing');
assert.equal(tutorAnswer('Show plumbing icons',p,asset).palette,'water');
assert.match(tutorAnswer('check my layout',collision,asset).reply,/overlapping/);
assert.equal(p.instances.length,0,'arrangements do not mutate original');
const manual=freshProject(asset);
for(let n=0;n<12;n++)manual.instances.push(individualCabin(manual,asset));
assert.deepEqual(review(manual,asset),{count:12,outside:[],overlaps:[],close:[]});
assert.throws(()=>individualCabin(manual,asset),/twelve/);
manual.instances.splice(3,1);manual.instances.push(individualCabin(manual,asset));assert.equal(new Set(manual.instances.map(i=>i.id)).size,12);
const small=freshProject(asset);small.site={width:40,depth:40};small.instances.push(individualCabin(small,asset));assert.throws(()=>individualCabin(small,asset),/No free placement/);assert.equal(small.instances.length,1);
console.log('Village core: arrangements, CAD transforms, collision checks, palette routing and project validation passed.');
