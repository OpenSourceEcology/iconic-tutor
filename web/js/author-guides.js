// These procedures describe authoring work shared across module families.
// Each compiler supplies its own inputs, validation results and generated files.
export const guides = {
  geometry: {
    aim: 'Define the members that belong to this module and check their placement.',
    steps: ['Identify the reference variant and record its units, origin, and supported parameter values.', 'Generate the model. Select a named member in the inspection view and compare its dimensions with the source.', 'Vary one supported parameter. Compare the member identities and dimensions against an independent measurement or drawing.'],
    repair: 'If a member moves or disappears unexpectedly, inspect the placement rule and the supported range before editing dependent drawings.',
  },
  connections: {
    aim: 'Describe how each internal joint joins named members.',
    steps: ['Inspect the joint schedule and identify both members at each joint.', 'Compare the available fastening sources. Record the hardware, count, placement, installation detail, and who reviewed the choice.', 'Regenerate the schedule and trace its hardware counts to the purchasing list.'],
    repair: 'Resolve a missing member ID in geometry or reconcile conflicting hardware choices with the reviewer. Keep unanswered joints open.',
  },
  rationale: {
    aim: 'Explain why each design choice applies to this configuration.',
    steps: ['Choose a design decision and cite the source where it appears.', 'Distinguish observed facts from proposed choices and record the limits of use.', 'Inspect the generated explanation. Check that each claim points to evidence and that open questions remain visible.'],
    repair: 'Add the missing source, narrow the claim, or record a question for the reviewer.',
  },
  bom: {
    aim: 'Reconcile the purchasing list with the modeled parts and joint schedule.',
    steps: ['Generate geometry, cuts, and connections to establish required quantities.', 'Record the stock size, supplier URL, date, and unit price. Document unavailable alternatives.', 'Recalculate line totals and account for the stock needed to make all cut pieces.'],
    repair: 'Trace a quantity discrepancy back to cuts or joints. Request a quote for an unpriced item.',
  },
  instructions: {
    aim: 'Turn the module dependencies into an assembly sequence that another contributor can follow.',
    steps: ['Read the geometry, cut schedule, and internal joint decisions.', 'For each step identify the parts, prerequisite steps, tools, and inspection point.', 'Walk through the generated instructions against the model. Confirm every included component has an installation step.'],
    repair: 'Resolve an upstream decision or record the absent operation and its evidence in the workstream notes.',
  },
  drawings: {
    aim: 'Save a drawing whose dimensions reference named model features.',
    steps: ['Generate the model and inspect its front and side views.', 'Select the named measurements the fabricator needs. Generate the sheet and compare their values with the model.', 'Change a supported parameter and regenerate. Inspect the sheet for retained, changed, or missing references.'],
    repair: 'Replace a missing feature with the intended current feature, or restore the original configuration and regenerate.',
  },
  cheatsheet: {
    aim: 'Put the critical steps and checks for the current variant onto a field sheet.',
    steps: ['Inspect the cuts, assembly sequence, tools, and QC records.', 'Generate the compact sheet. Check that its part counts and dimensions match the detailed files.', 'Read it at its intended size and record any field instruction that needs a clearer source.'],
    repair: 'Correct the detailed source record and regenerate the sheet so both stay in sync.',
  },
  cuts: {
    aim: 'Trace finished pieces to purchased stock and account for cutting losses.',
    steps: ['Check each named cut piece against geometry.', 'Enter available stock length and cutting kerf in the displayed units.', 'Regenerate and compare the board allocation, offcuts, and finished pieces with purchasing quantities.'],
    repair: 'Check units, stock length, and kerf for an unplaceable piece. Keep stock allowances distinct from finished dimensions.',
  },
  qc: {
    aim: 'Define inspections and distinguish measured results from checks that remain open.',
    steps: ['Identify the feature, method, and acceptance tolerance for the inspection.', 'Record actual measurements and attribution only after inspection.', 'Run a deliberately failing example on a separate project and confirm the result identifies the failed check.'],
    repair: 'Investigate a failed measurement against the source tolerance. Keep an unperformed check pending.',
  },
  interfaces: {
    aim: 'Specify what adjoining modules must satisfy at each boundary.',
    steps: ['Identify each face and the shared interface record it references.', 'Record the mating face, alignment rule, and tolerance with a source and reviewer.', 'Compare one compatible and one incompatible mate. Inspect the reason given for each result.'],
    repair: 'Correct the interface record or the proposed mate. Keep hardware selection in the connection schedule.',
  },
  icons: {
    aim: 'Publish a parametric icon whose visible label agrees with its encoded values.',
    steps: ['Check the variant ID and parameters against the model.', 'Generate the SVG and inspect the visible label and machine-readable values.', 'Change the variant, regenerate, and run the round-trip check.'],
    repair: 'Repair the icon definition or parameter mapping if the parsed values diverge.',
  },
};

export const fieldHelp = {
  decisions: ['Design decisions', 'Record each decision with its source and limits of use.'],
  inspections: ['Inspection records', 'Record performed measurements only. Leave each unperformed check open.'],
  interface_reviews: ['Interface reviews', 'Identify the shared boundary and cite the reviewed mating requirement.'],
  quotes: ['Supplier quotes', 'Use the exact material or hardware IDs from the BOM, with price, source, and date.'],
  stock_length_in: ['Purchased board length (in)', ''],
  kerf_in: ['Saw kerf (in)', ''],
};


// A registry entry without a compiler can still collect the information a future
// author needs. These questions apply to parts, assemblies, and non-wall modules.
export const intakeQuestions = {
  geometry: 'Which parts and model features belong to this module? Record the units, reference frame, ranges, and a source for the first variant.',
  connections: 'Which parts meet inside this module? Identify the contact, hardware or joining method, source, and unresolved decisions.',
  rationale: 'Which design choice is established, who made it, and under which conditions does it apply?',
  bom: 'Which items must be purchased? Record available stock sizes, supplier references, quote dates, and missing prices.',
  instructions: 'Which operations, tools, and prior steps are needed to assemble the module? Cite the build record for each.',
  drawings: 'Which views and named features should appear on a fabrication sheet? Record the dimensions a contributor needs to choose.',
  cheatsheet: 'Which parts, operations, and checks belong on a field sheet? Link the full instructions behind each.',
  cuts: 'Which pieces need to be cut or fabricated? Record material, source stock, allowances, and finished dimensions.',
  qc: 'Which measurements establish acceptance? Identify the method, tolerance, and evidence needed from the physical module.',
  interfaces: 'Which external boundaries mate with other modules? Locate shared references and identify unresolved requirements.',
  icons: 'Which parameters must a contributor read from the icon? Gather a source icon and the proposed mapping to a module instance.',
};
