// Halt, single-step twice, then inspect registers, memory and the image plugin.
(async () => {
  const s = window.studioDebug;
  s.applyTheme('dark');
  await s.session.connect({ mock: true, mode: 'attach' });
  await s.session.debug('pause');
  await s.session.debug('next');
  await new Promise(resolve => setTimeout(resolve, 300));
  await s.session.debug('stepIn');
  await new Promise(resolve => setTimeout(resolve, 500));
  s.workbench.inspector.activate('registers');
  s.bus.emit('memory:show', { address: 0x20010000, length: 128 });
  await s.executeCommand('memory-image:open');
  s.showSidebar('plugins');
  await new Promise(resolve => setTimeout(resolve, 1200));
  const regs = [...document.querySelectorAll('.reg-row')].map(row => row.textContent);
  return { status: s.session.status, registers: regs.length, changed: document.querySelectorAll('.reg-row.changed').length, stopId: s.session.stopId };
})()
