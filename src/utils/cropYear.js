/** Orchard crop year: 1 May through 30 April. */

export function parseLocalDate(dateInput) {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    const [y, m, d] = dateInput.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(dateInput);
}

/** Start calendar year of the crop year containing the given date. */
export function getCropYearStartYear(dateInput = new Date()) {
  const date = parseLocalDate(dateInput);
  return date.getMonth() >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

export function getCropYearRange(startYearOrDate) {
  const startYear = typeof startYearOrDate === 'number'
    ? startYearOrDate
    : getCropYearStartYear(startYearOrDate);

  return {
    startYear,
    startDate: `${startYear}-05-01`,
    endDate: `${startYear + 1}-04-30`,
    label: `${startYear}–${String(startYear + 1).slice(-2)}`,
  };
}

export function getCurrentCropYearRange() {
  return getCropYearRange(new Date());
}

export function isWithinCropYear(dateStr, cropYearRange = getCurrentCropYearRange()) {
  if (!dateStr) return false;
  const date = String(dateStr).slice(0, 10);
  return date >= cropYearRange.startDate && date <= cropYearRange.endDate;
}

export function filterRecordsForCropYear(records, dateField = 'harvest_date', cropYearRange = getCurrentCropYearRange()) {
  return (records || []).filter((record) => isWithinCropYear(record[dateField], cropYearRange));
}

export function cropYearNoticeText(cropYearRange = getCurrentCropYearRange()) {
  return `Calculations use crop year 1 May – 30 Apr (current: ${cropYearRange.label}). Multiple harvests in a year are summed into one total.`;
}

/** Sum harvest records into one row per crop year. */
export function aggregateRecordsByCropYear(records, dateField = 'harvest_date') {
  const byYear = {};

  (records || []).forEach((record) => {
    const dateValue = record[dateField];
    if (!dateValue) return;

    const startYear = getCropYearStartYear(dateValue);
    if (!byYear[startYear]) {
      const range = getCropYearRange(startYear);
      byYear[startYear] = {
        startYear,
        label: range.label,
        startDate: range.startDate,
        endDate: range.endDate,
        yieldKg: 0,
        revenue: 0,
        harvestCount: 0,
      };
    }

    byYear[startYear].yieldKg += Number(record.quantity_kg || 0);
    byYear[startYear].revenue += Number(record.revenue || 0);
    byYear[startYear].harvestCount += 1;
  });

  return Object.values(byYear).sort((a, b) => a.startYear - b.startYear);
}
