// CSV for sampled channels. A channel is anything with length, time(i) and value(i).

/**
 * CSV text for channels on one time base: one row per distinct timestamp (merged
 * across channels), blank cells where a channel has no sample at that time.
 */
export function channelsToCsv(series) {
  const rows = [['time_s', ...series.map(item => item.label)].join(',')];
  const cursors = series.map(() => 0);
  for (;;) {
    let time = Infinity;
    series.forEach(({ channel }, k) => { if (cursors[k] < channel.length) time = Math.min(time, channel.time(cursors[k])); });
    if (time === Infinity) break;
    const cells = series.map(({ channel }, k) => {
      if (cursors[k] >= channel.length || Math.abs(channel.time(cursors[k]) - time) > 1e-9) return '';
      return channel.value(cursors[k]++);
    });
    rows.push([time.toFixed(9), ...cells].join(','));
  }
  return `${rows.join('\n')}\n`;
}
