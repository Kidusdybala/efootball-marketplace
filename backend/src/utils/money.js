const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || 'ETB';

function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const n = Number(amount);
  const c = currency || DEFAULT_CURRENCY;
  if (!Number.isFinite(n)) return `${c} 0`;
  const isInt = Math.round(n) === n;
  const minFrac = isInt ? 0 : 2;
  const maxFrac = isInt ? 0 : 2;
  try {
    const fmt = new Intl.NumberFormat('en-ET', { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
    return `${c} ${fmt.format(n)}`;
  } catch (e) {
    return `${c} ${isInt ? String(Math.round(n)) : n.toFixed(2)}`;
  }
}

module.exports = { DEFAULT_CURRENCY, formatMoney };
