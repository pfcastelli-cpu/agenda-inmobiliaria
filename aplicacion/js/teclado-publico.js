// Las fechas y horas de las páginas públicas son <div role="button">: con este escuchador, Enter y Espacio
// funcionan como un clic (teclado y lectores de pantalla), sin tocar cada página.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.matches('[role="button"]')) {
    e.preventDefault();
    e.target.click();
  }
});
