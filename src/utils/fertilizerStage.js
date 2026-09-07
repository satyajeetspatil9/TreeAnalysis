export function npkTargetsForStage(stage, lab = {}) {
  const baseN = Number(lab.nitrogen);
  const baseP = Number(lab.phosphorus);
  const baseK = Number(lab.potassium);
  const n = Number.isFinite(baseN) ? baseN : 50;
  const p = Number.isFinite(baseP) ? baseP : 25;
  const k = Number.isFinite(baseK) ? baseK : 50;
  const key = String(stage || '').toLowerCase();

  if (key.includes('flower')) {
    return {
      n: n * 0.6,
      p: p * 1.2,
      k: k * 1.1,
      notes: 'Ease nitrogen in flowering; keep P and K up for bloom.',
    };
  }
  if (key.includes('fruit') || key.includes('nut')) {
    return {
      n: n * 0.8,
      p: p,
      k: k * 1.3,
      notes: 'Support fruit fill with potassium.',
    };
  }
  if (key.includes('maturity')) {
    return {
      n: n * 0.5,
      p: p * 0.8,
      k: k * 0.8,
      notes: 'Taper fertilizer before harvest.',
    };
  }
  return {
    n,
    p,
    k,
    notes: 'Vegetative / canopy growth — balanced N from latest lab.',
  };
}
