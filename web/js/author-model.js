const NS = 'http://www.w3.org/2000/svg';

function svgNode(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

// Orthographic views and the axonometric projection share the dimensions and
// positions of the named solids exported by the module compiler.
export function showModel(host, members) {
  host.replaceChildren();
  if (!members?.length) return;
  let view = 'Axonometric', selected = members[0].id;
  const controls = document.createElement('div');
  controls.className = 'axes';
  host.append(controls);
  const svg = svgNode('svg', {role:'img', 'aria-label':'Framing member projection'}, host);
  const label = document.createElement('label');
  label.className = 'field';
  label.textContent = 'Inspect member';
  const select = document.createElement('select');
  select.id = 'inspect-member';
  for (const m of members) select.add(new Option(m.id, m.id));
  label.append(select);
  const caption = document.createElement('p');
  host.append(label, caption);
  for (const name of ['Axonometric', 'Front', 'Side']) {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.onclick = () => { view = name; draw(); };
    controls.append(btn);
  }
  select.onchange = () => { selected = select.value; draw(); };
  function draw() {
    svg.replaceChildren();
    for (const btn of controls.children) btn.setAttribute('aria-pressed', String(btn.textContent === view));
    const project = ([x,y,z]) => view === 'Front' ? [x,-z] : view === 'Side' ? [y,-z] : [x + .6*y, -z - .36*y + .12*x];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    // Draw far surfaces first. Each selectable face belongs to a named CAD member.
    const sorted = [...members].sort((a,b) => a.z_in - b.z_in || a.x_in - b.x_in);
    for (const m of sorted) {
      const x = m.x_in, y = m.y_in, z = m.z_in;
      const r = x + m.width_in, b = y + m.depth_in, t = z + m.height_in;
      const faces = [
        [[r,y,z],[r,b,z],[r,b,t],[r,y,t]],
        [[x,y,t],[r,y,t],[r,b,t],[x,b,t]],
        [[x,y,z],[r,y,z],[r,y,t],[x,y,t]],
      ];
      const group = svgNode('g', {'data-member':m.id}, svg);
      svgNode('title', {}, group).textContent = m.id;
      group.onclick = () => { select.value = selected = m.id; draw(); };
      const colors = m.id === selected ? ['#977b2e','#eee0a1','#cbb963'] : ['#678371','#b6c7a5','#91ab90'];
      faces.forEach((face, i) => {
        const pts = face.map(project);
        for (const [px,py] of pts) {
          minX = Math.min(minX, px); maxX = Math.max(maxX, px);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
        svgNode('polygon', {points:pts.map(pt => pt.join(',')).join(' '), fill:colors[i], stroke:'#334b3e', 'stroke-width':'.2'}, group);
      });
    }
    svg.setAttribute('viewBox', [minX-4,minY-4,maxX-minX+8,maxY-minY+8].join(' '));
    const m = members.find(member => member.id === selected);
    caption.textContent = [m.nominal, m.role?.replaceAll('_',' '), `${m.length_in} in cut length`].filter(Boolean).join(' · ');
  }
  draw();
}
