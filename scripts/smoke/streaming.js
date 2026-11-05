// Connect the simulated target, plot three channels, watch two variables.
(async () => {
  const s = window.studioDebug;
  s.applyTheme('dark');
  await s.session.connect({ mock: true, mode: 'attach' });
  const plot = s.openPlot();
  for (const id of ['mock.sine', 'mock.cosine', 'mock.ramp']) plot.addTrace(s.session.variable(id));
  await s.session.debug('continue');
  s.bus.emit('watch:add', s.session.variable('mock.ramp'));
  s.bus.emit('watch:add', s.session.variable('mock.noise'));
  s.workbench.inspector.activate('watch');
  s.showSidebar('symbols');
  await new Promise(resolve => setTimeout(resolve, 2500));
  return { status: s.session.status, traces: plot.traces.length, channels: [...plot.channels.keys()], latest: plot.latest.toFixed(2) };
})()
