// Restore preferences before the canvas reads them. Browser mode remains unchanged.
(async () => {
  if (window.apoxiaDesktop) {
    try {
      const values = await window.apoxiaDesktop.restorePreferences();
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    } catch (error) { console.error('No se pudieron restaurar las preferencias de escritorio:', error.message); }
  }
  const loadScript = src => new Promise((resolve,reject)=> {
    const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error(`Could not load ${src}`));document.head.append(script);
  });
  try {
    await loadScript('/i18n.js');
    await window.apoxiaI18n.init();
    await loadScript('/image-crop.js');
    await loadScript('/gpu-spatial.js');
    await loadScript('/svg-vector.js');
    await loadScript('/gpu-renderer.js');
    await loadScript('/app.js');
  } catch(error) {console.error(error);document.querySelector('#toast').textContent=error.message;document.querySelector('#toast').classList.add('show');}
})();
