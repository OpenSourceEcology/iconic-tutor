// Editing a workstream updates its fields in the shared module instance.
// Inputs absent from a module's contract fall back to a JSON editor.
import {fieldHelp} from './author-guides.js';

export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function field(label, control) {
  const group = el('label', label, 'field');
  group.append(control);
  return group;
}
function selectOf(options, value) {
  const input = document.createElement('select');
  for (const opt of options) input.add(new Option(String(opt), String(opt)));
  input.value = String(value);
  return input;
}

const reviewer = ['reviewer', 'Reviewed by'];
const source = ['source', 'Evidence or source reference'];
const hardware = [
  ['hardware_id','Hardware ID'], ['per_joint','Fasteners per joint','number'],
  ['installation','Installation detail'], ['positions_in','Positions in contact face (in) · JSON pairs','json'],
  reviewer, source,
];
const records = {
  quotes: {label:'Supplier quote', key:'Purchased item ID', fields:[
    ['supplier','Supplier'], ['url','Source URL','url'], ['as_of','Quote date','date'],
    ['unit_price_usd','Price per pack (USD)','number'], ['units_per_pack','Units per pack','number'],
    ['alternatives','Alternative URLs · JSON list','json'], ['alternatives_note','Availability of alternatives'],
  ]},
  decisions: {label:'Design decision', array:true, fields:[['id','Decision ID'],['reason','Reason and limits'],reviewer,source]},
  inspections: {label:'Inspection record', keys:['width','height','diagonal_difference','layout_offset'], fields:[
    ['spacing_in','Specimen spacing (in)','number'], ['specimen','Specimen ID'], ['method','Measurement method'],
    ['measured_in','Measured (in)','number'], ['tolerance_in','Tolerance (in)','number'],reviewer,source,
  ]},
  interface_reviews: {label:'Interface review', keys:['left','right','top','bottom','partition'], fields:[
    ['mate','Mating reference'],['alignment','Alignment'],['clearance_in','Clearance (in)','number'],
    ['tolerance_in','Tolerance (in)','number'],['requirement','Connection requirement'],reviewer,source,
  ]},
};

function canEditRecords(key,value) {
  const isObject = entry => entry != null && typeof entry === 'object' && !Array.isArray(entry);
  if (key === 'fastening' || key === 'plate_fastening') return value === null || isObject(value);
  if (!Object.hasOwn(records,key)) return false;
  return records[key].array ? Array.isArray(value) && value.every(isObject)
    : isObject(value) && Object.values(value).every(isObject);
}

function structuredRecords(host, key, instance, notify) {
  const isSchedule = ['fastening','plate_fastening'].includes(key);
  const schema = isSchedule ? {fields:hardware, label:key === 'fastening' ? 'Stud-to-plate schedule' : 'Plate-to-plate schedule'} : records[key];
  const container = el('fieldset');
  const title = el('legend', fieldHelp[key]?.[0] ?? schema.label);
  container.append(title);
  host.append(container);
  let rows = schema.array ? (instance[key] ?? []).map(value=>['',value])
    : isSchedule ? (instance[key] ? [['', instance[key]]] : []) : Object.entries(instance[key] ?? {});
  // Invalid array/JSON edits remain visible until the contributor fixes them.
  const keyControls = [], controls = [];
  function read() {
    const seen = new Set();
    return rows.map((row, index) => {
      const value = {...row[1]};
      const keyInput = keyControls[index];
      const name = keyInput ? keyInput.value.trim() : row[0];
      if (keyInput) {
        if (!name) throw new Error(`Enter the ${schema.key || 'record name'} before saving.`);
        if (seen.has(name)) throw new Error(`The record name "${name}" is used twice.`);
        seen.add(name);
      }
      for (const [name, input, type] of controls[index]) {
        if (!input.value.trim()) delete value[name];
        else if (type === 'json') {
          try { value[name] = JSON.parse(input.value); }
          catch { throw new Error(`Enter valid JSON for ${name.replaceAll('_',' ')}.`); }
        } else value[name] = type === 'number' ? Number(input.value) : input.value.trim();
      }
      return [name, value];
    });
  }
  function sync() {
    rows = read();
    instance[key] = isSchedule ? (rows[0]?.[1] ?? null)
      : schema.array ? rows.map(row=>row[1]) : Object.fromEntries(rows);
  }
  function paint() {
    keyControls.length = controls.length = 0;
    container.replaceChildren(title);
    if (fieldHelp[key]?.[1]) container.append(el('p',fieldHelp[key][1]));
    rows.forEach(([name, record], index) => {
      const group = el('div', undefined, 'form-row');
      container.append(group);
      if (schema.key || schema.keys) {
        const keyInput = schema.keys ? selectOf(schema.keys, name) : el('input');
        keyInput.value = name;
        keyControls[index] = keyInput;
        group.append(field(schema.key || 'Record name',keyInput));
      }
      controls[index] = [];
      for (const [name,label,type] of schema.fields) {
        const input = el('input');
        input.type = !type || type === 'json' ? 'text' : type;
        if (type === 'number') input.step = 'any';
        input.value = type === 'json' && record[name] !== undefined ? JSON.stringify(record[name]) : (record[name] ?? '');
        controls[index].push([name,input,type]);
        group.append(field(label, input));
      }
      const remove = el('button', isSchedule ? 'Leave decision open' : 'Remove record');
      remove.type = 'button';
      remove.onclick = () => {
        // Remove the discarded row even when one of its fields contains invalid input.
        const old = rows, oldKeys = [...keyControls], oldCtrls = [...controls];
        rows = rows.filter((_, i)=>i !== index);
        keyControls.splice(index,1); controls.splice(index,1);
        try { sync(); paint(); notify(); }
        catch (e) { rows = old; keyControls.splice(0,Infinity,...oldKeys); controls.splice(0,Infinity,...oldCtrls); notify(e.message); }
      };
      container.append(remove);
    });
    if (!isSchedule || !rows.length) {
      const add = el('button', 'Add ' + schema.label.toLowerCase());
      add.type = 'button';
      add.onclick = () => {
        try {
          sync();
          const keyName = schema.keys?.find(k=>!rows.some(([key])=>key===k)) ?? '';
          if (schema.keys && !keyName) return;
          rows.push([keyName,{}]); paint();
          controls.at(-1)?.[0]?.[1].focus();
          notify();
        } catch(e) { notify(e.message); }
      };
      container.append(add);
    }
    if (isSchedule && !rows.length) container.prepend(el('p','Awaiting a reviewed joint schedule.','muted'));
  }
  container.addEventListener('input', () => {
    // The parent collects all editors before saving; partial records stay editable.
    try { sync(); notify(); } catch(e) { notify(e.message); }
  });
  paint();
  return sync;
}

export function editFields(host, instance, stream, manifest, notify) {
  host.replaceChildren();
  const readers = [];
  function connect(control, property, get) {
    control.addEventListener('input', () => { instance[property] = get(); notify(); });
  }
  for (const key of stream.inputs || []) {
    if (!(key in instance)) continue;
    if (key === 'spacing_in' && instance.module_id === 'ICHL-015') {
      const control = selectOf([16,24], instance.spacing_in);
      control.id = 'spacing';
      host.append(field('Stud spacing (inches on center)',control));
      connect(control,key,()=>Number(control.value));
    } else if (key === 'drawing_dimensions' && Array.isArray(instance[key])) {
      const box = el('fieldset');
      box.append(el('legend','Drawing dimensions'));
      const dims = new Map((manifest?.available_dimensions ?? []).map(d=>[d.id,d]));
      for (const id of instance[key]) if (!dims.has(id)) dims.set(id,{id, label:manifest ? 'Missing from generated variant' : 'Saved reference'});
      if (!manifest) box.append(el('p','Generate the wall to see all available features.'));
      for (const [id, dim] of dims) {
        const check = el('input');
        check.type = 'checkbox'; check.value = id; check.checked = instance[key].includes(id);
        const row = el('label',undefined,'checkbox');
        row.append(check,document.createTextNode(`${id} · ${dim.label}${dim.value_in == null ? '' : ' · ' + dim.value_in + ' in'}`));
        check.onchange = () => { instance[key] = [...box.querySelectorAll('input:checked')].map(ch=>ch.value); notify(); };
        box.append(row);
      }
      host.append(box);
    } else if (instance.module_id === 'ICHL-015' && canEditRecords(key,instance[key])) {
      readers.push(structuredRecords(host,key,instance,notify));
    } else if (typeof instance[key] === 'number') {
      const input = el('input'); input.type = 'number'; input.step = 'any'; input.value = instance[key];
      host.append(field(fieldHelp[key]?.[0] || key.replaceAll('_',' '),input));
      connect(input,key,()=>input.value === '' ? null : Number(input.value));
    } else {
      const control = el('textarea'); control.rows = 3; control.value = JSON.stringify(instance[key], null, 2);
      host.append(field(key.replaceAll('_',' ') + ' · JSON',control));
      const read = () => { try { instance[key] = JSON.parse(control.value); } catch { throw new Error('Enter valid JSON for ' + key); } };
      readers.push(read);
      control.oninput = () => { try { read(); notify(); } catch(e) { notify(e.message); } };
    }
  }
  return () => { for (const read of readers) read(); };
}
