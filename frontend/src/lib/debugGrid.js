export function debugRows(label, rows, getRowId) {
  /* 1) warn about duplicates / undefined ids */
  const seen = new Set();
  const dups = [];
  rows.forEach(r => {
    const id = getRowId(r);
    if (id === undefined) console.warn(`${label}: row with undefined id`, r);
    else if (seen.has(id)) dups.push(id);
    else seen.add(id);
  });
  if (dups.length) console.warn(`${label}: duplicate ids`, dups);

  /* 2) warn if any row has a non-plain prototype */
  rows.forEach(r => {
    if (Object.getPrototypeOf(r) !== Object.prototype) {
      console.warn(`${label}: non-plain row`, r);
    }
  });
}
