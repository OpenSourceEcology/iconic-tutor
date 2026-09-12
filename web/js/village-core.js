export const FT = 304.8;
export const CABIN_ID = "vcs_cabin_13x13_two_story";
export const WIKI = "https://wiki.opensourceecology.org/wiki/Village_Construction_Set";
export const SOURCES = [
  { title: "Village Construction Set · icon library", url: WIKI },
  { title: "301 ICHL icons · gallery", url: "https://wiki.opensourceecology.org/wiki/301_ICHL_Icons" },
  { title: "301 ICHL icons · registry", url: "https://wiki.opensourceecology.org/wiki/Registry_for_the_301_ICHL_Icons" },
  { title: "Campus cabin requirements", url: "https://docs.google.com/document/d/12_IVKSW9nyVd7IEcWdcFKTnYZS_FlcaYooM3YBeR-Rw/edit" },
  { title: "Cabin specifications · source CAD", url: "https://drive.google.com/drive/folders/1RaxQKtPVD2EWIfH2x34ccKwUKbcFWWv1" },
  { title: "Cabin concepts · two stories + deck", url: "https://docs.google.com/presentation/d/1lhz7eqToB9vXJuHkz3y4ySXMoaB32VcU_R6oFI1ypXw/edit?slide=id.g3f82e373ec9_0_0" },
];
const names = ["Roof", "Wall", "Floor / Foundation", "Door", "Window", "Kitchen", "Bath / Shower", "Heat Pump", "Power Wall", "Utility Wall", "Pump Vault", "Horizontal Stackability", "Septic Fertigation", "Hallway", "Water Purification Module", "Water Storage", "Biodigester", "Gas Collection", "Retaining Wall", "Living Wall", "Grow Column", "Siding Module", "Grow Box", "Tree Module", "Production Kitchen", "Vertical Stackability", "PV", "Gutter", "Drywall", "Passive House Wall", "Utility Channel"];
export const ICONS = names.map((name, i) => ({name, index: i, available: false,
  set: [7,8,26].includes(i) ? "energy" : [10,12,14,15,16,17,27].includes(i) ? "water" : [18,19,20,22,23].includes(i) ? "landscape" : "housing"}));
export const SETS = {all: "All library icons", vcs: "VCS · 31 assembly icons", ichl: "ICHL · 301 registry icons", housing: "Buildings & shared spaces", site: "Site & foundations", framing: "Framing & structure", envelope: "Roof & building envelope", water: "Plumbing, water & waste", energy: "Electrical & energy", climate: "HVAC & ventilation", interiors: "Interiors & finishes", tools: "Tools & build process", landscape: "Landscape & growing"};
export function filterIcons(icons,set,query='') {
  const q=query.trim().toLowerCase();
  return icons.filter(i=>(set==='all'||(i.sets||['vcs',i.set]).includes(set))&&`${i.name} ${i.id||''} ${i.wiki_target||''}`.toLowerCase().includes(q));
}
export const STEPS = [
  {title: "Understand the site", text: "Start with a site size and a name for your village. The rectangle is a planning boundary; north is up. Where are the entrance, slope, sun and existing trees? Record what you know before placing cabins.", set: "housing"},
  {title: "Arrange twelve cabins", text: "Try a courtyard or rows, then drag cabins to shape the village. Each icon is one complete two-story cabin. Select a cabin to rotate it or set its position in feet. The small triangle marks the front/porch side.", set: "housing"},
  {title: "Plan life between buildings", text: "Reserve room for daylight, shared outdoor space and weather-sheltered routes to bathrooms and kitchens. Call up water, energy or landscape icons to explore what belongs here. Grey icons are references awaiting placeable models. Capture your shared-space plan below.", set: "landscape"},
  {title: "Review the village", text: "Check the count, boundaries, overlaps and your chosen planning clearance. Revisit entrances and routes. Save the layout to continue later or export a plan for discussion. These checks describe geometry; stairs, utilities, terrain and engineering still need design.", set: "all"},
];
export const freshProject = (asset) => ({format: "iconic-village", version: 1, asset_id: CABIN_ID, source_revision: asset.source_revision,
  name: "A village of twelve", site: {width: 140, depth: 120}, gap: 10, step: 0, palette: "all", notes: "", shared: "", instances: [], conversation: []});
export function validateProject(p, asset) {
  const bounded = (n, a, b) => typeof n === "number" && Number.isFinite(n) && n >= a && n <= b;
  if (!p || p.format !== "iconic-village" || p.version !== 1 || p.asset_id !== CABIN_ID || p.source_revision !== asset.source_revision) throw Error("This file does not reference the installed village cabin revision.");
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 120 || !bounded(p.site?.width,40,1000) || !bounded(p.site?.depth,40,1000) || !bounded(p.gap,0,100) || !Number.isInteger(p.step) || !STEPS[p.step] || !Object.hasOwn(SETS,p.palette)) throw Error("Invalid project name, site size, spacing or lesson step.");
  if (![p.notes,p.shared].every(s=>typeof s === "string" && s.length <= 4000)) throw Error("Project notes must be under 4,000 characters.");
  if (!Array.isArray(p.instances) || p.instances.length > 12) throw Error("This lesson supports up to twelve cabins.");
  const ids = new Set();
  for (const i of p.instances) {
    if (!/^cabin-[a-zA-Z0-9-]{1,60}$/.test(i.id) || ids.has(i.id) || !bounded(i.x,-1000,2000) || !bounded(i.y,-1000,2000) || ![0,90,180,270].includes(i.rotation)) throw Error("Invalid or duplicate cabin placement.");
    ids.add(i.id);
  }
  if (!Array.isArray(p.conversation) || p.conversation.length > 30 || p.conversation.some(m=>!m || !["user","assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 6000)) throw Error("Invalid tutor conversation.");
  return structuredClone(p);
}
export function envelope(i, asset) {
  const swap = i.rotation % 180 !== 0;
  const w = asset.bounds[swap ? 4 : 3]/FT, d = asset.bounds[swap ? 3 : 4]/FT;
  return {x:i.x-w/2,y:i.y-d/2,w,d};
}
export function layout(p, asset, pattern) {
  if (!["courtyard","rows"].includes(pattern)) throw Error("Unknown arrangement.");
  const next = structuredClone(p), w=asset.bounds[3]/FT,d=asset.bounds[4]/FT,g=p.gap;
  const cx=p.site.width/2,cy=p.site.depth/2;
  next.instances = [];
  const add=(x,y,rotation)=>next.instances.push({id:`cabin-${next.instances.length+1}`,x,y,rotation});
  if (pattern === "rows") {
    for(let row=0;row<3;row++) for(let col=0;col<4;col++) add(cx+(col-1.5)*(w+g),cy+(row-1)*(d+g),0);
  } else {
    const sideX=2*w+2.5*g+d/2, sideY=(d+w+g*2)/2;
    for(let col=0;col<4;col++) {add(cx+(col-1.5)*(w+g),cy+sideY,0);add(cx+(col-1.5)*(w+g),cy-sideY,180);}
    for(let row=0;row<2;row++) {add(cx-sideX,cy+(row-.5)*(w+g),90);add(cx+sideX,cy+(row-.5)*(w+g),270);}
  }
  return next;
}
export function individualCabin(p, asset) {
  if (p.instances.length >= 12) throw Error("All twelve cabins are placed. Remove one before adding another.");
  // Document-local IDs need no secure-context browser API and cannot collide
  // with either imported IDs or the arrangement presets.
  let number = 1;
  while (p.instances.some(i => i.id === `cabin-${number}`)) number++;
  const w = asset.bounds[3]/FT, d = asset.bounds[4]/FT;
  const cx = p.site.width/2, cy = p.site.depth/2;
  const candidates = [];
  for (let row = -Math.ceil(cy/(d+p.gap)); row <= Math.ceil(cy/(d+p.gap)); row++) {
    for (let col = -Math.ceil(cx/(w+p.gap)); col <= Math.ceil(cx/(w+p.gap)); col++) {
      candidates.push({id:`cabin-${number}`, x:cx+col*(w+p.gap), y:cy+row*(d+p.gap), rotation:0});
    }
  }
  candidates.sort((a,b) => Math.hypot(a.x-cx,a.y-cy)-Math.hypot(b.x-cx,b.y-cy));
  const existing = p.instances.map(i => envelope(i,asset));
  for (const candidate of candidates) {
    const a = envelope(candidate,asset);
    if (a.x < 0 || a.y < 0 || a.x+a.w > p.site.width || a.y+a.d > p.site.depth) continue;
    const clear = existing.every(b => {
      const dx = Math.max(a.x-b.x-b.w,b.x-a.x-a.w), dy = Math.max(a.y-b.y-b.d,b.y-a.y-a.d);
      return !(dx < -1e-7 && dy < -1e-7) && Math.hypot(Math.max(0,dx),Math.max(0,dy)) >= p.gap-1e-7;
    });
    if (clear) return candidate;
  }
  throw Error("No free placement was found at this clearance. Move existing cabins, reduce planning clearance or enlarge the site, then try again.");
}
export function review(p,asset) {
  const outside=[],overlaps=[],close=[];
  const boxes=p.instances.map(i=>envelope(i,asset));
  boxes.forEach((a,i)=>{
    if(a.x < -1e-7 || a.y < -1e-7 || a.x+a.w > p.site.width+1e-7 || a.y+a.d > p.site.depth+1e-7) outside.push(i+1);
    for(let j=i+1;j<boxes.length;j++) {
      const b=boxes[j],dx=Math.max(a.x-b.x-b.w,b.x-a.x-a.w),dy=Math.max(a.y-b.y-b.d,b.y-a.y-a.d);
      if(dx < -1e-7 && dy < -1e-7) overlaps.push([i+1,j+1]);
      else if(Math.hypot(Math.max(0,dx),Math.max(0,dy)) < p.gap-1e-7) close.push([i+1,j+1]);
    }
  });
  return {count:p.instances.length,outside,overlaps,close};
}
export function viewProject(p,asset) {
  return {assets:[asset],instances:p.instances.map(i=>{
    const r=i.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r),w=asset.bounds[3],d=asset.bounds[4];
    return {id:i.id,asset_id:asset.id,position:[i.x*FT-c*w/2+s*d/2,i.y*FT-s*w/2-c*d/2,0],rotation:[0,0,i.rotation]};
  })};
}
export function tutorAnswer(text,p,asset) {
  const q=text.toLowerCase(), report=review(p,asset);
  let palette=null;
  if (/\b(show|open|call|switch|need|palette)\b/.test(q)) {
    palette=/ichl|301|registry/.test(q)?"ichl":/\bvcs\b|assembly icons/.test(q)?"vcs":/\b(all|every|village)\b|construction set/.test(q)?"all":/water|waste|bath|septic|plumb/.test(q)?"water":/energy|solar|power|electri/.test(q)?"energy":/hvac|heat|ventilat|cooling/.test(q)?"climate":/site|foundation|grading/.test(q)?"site":/framing|structur|truss/.test(q)?"framing":/roof|envelope|insulat|window/.test(q)?"envelope":/interior|finish|cabinet/.test(q)?"interiors":/tool|jig|workflow|process/.test(q)?"tools":/landscap|garden|grow|tree/.test(q)?"landscape":/hous|build|cabin|kitchen|hallway/.test(q)?"housing":null;
  }
  if (palette) return {palette,reply:`Here is ${SETS[palette].toLowerCase()}. The two-story cabin is the first placeable library entry. The other wiki icons are grey until their models are available. Your ${report.count} cabin placements are retained.`};
  if (/check|review|overlap|clearance/.test(q)) return {reply:`You have ${report.count}/12 cabins, ${report.outside.length} outside the site, ${report.overlaps.length} overlapping pairs and ${report.close.length} pairs below your ${p.gap} ft planning clearance. ${report.outside.length||report.overlaps.length||report.close.length?"Select and move the flagged cabins, or adjust the site and arrangement.":"Next, check the front/porch markers and describe sheltered routes to shared bathrooms and kitchens."}`};
  if (/dimension|size|spec|stor|height/.test(q)) return {reply:`Each icon uses the supplied two-story 13×13 cabin CAD, including the porch and roof: ${(asset.bounds[3]/FT).toFixed(2)} × ${(asset.bounds[4]/FT).toFixed(2)} ft overall, ${(asset.bounds[5]/FT).toFixed(2)} ft high. The wiki describes nominal 12×12 modules; this specific model has a larger envelope. The cabin geometry is fixed in this lesson; positions, orientations and site dimensions are editable.`};
  if (/bath|kitchen|access|path|stair|shelter/.test(q)) return {reply:"The requirements call for weather-sheltered access to bathrooms and kitchens, with daylight in hallways. Keep the porch side reachable and reserve space for stairs to upper entries. Those connections are not modeled in this cabin layout. Describe the route and shared facilities in Shared-space plan; call up buildings or water icons to explore the future modules."};
  if (/courtyard|row|arrang|place|twelve|12/.test(q)) return {reply:`Use “Courtyard · 12” to face the cabins toward a shared center, or “Rows · 12” for parallel rows. You currently have ${report.count}/12. The arrangement buttons replace the current positions in one undoable step. Then drag a cabin and use Rotate to refine its entrance direction.`};
  if (/sun|north|slope|terrain|tree/.test(q)) return {reply:"North is up on the plan. Record the real entrance, sun, slope and trees in Site observations. This study uses a flat planning boundary; it has no surveyed terrain or solar analysis. Leave space for daylight and existing vegetation, then adjust each cabin’s porch orientation."};
  return {reply:`${STEPS[p.step].text} Your project currently contains ${report.count}/12 cabins. You can ask “show water icons”, “show energy icons”, “show all icons”, “cabin dimensions” or “check my layout”.`};
}
