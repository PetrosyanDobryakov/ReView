// Test-environment stub: engine tests never render formulas.
export default '';
export const mathjax = { document: () => ({ convert: () => null }) };
export const TeX = class {};
export const SVG = class {};
export const LiteAdaptor = class {};
export function RegisterHTMLHandler() {}

export function renderFormula() {
  return { valid: false, wEx: 0, hEx: 0, svg: '' };
}

export function formulaImage() {
  return { img: null, w: 0, h: 0 };
}

export function onFormulaLoad() {
  return () => {};
}
