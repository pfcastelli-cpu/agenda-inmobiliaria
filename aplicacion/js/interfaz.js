import { iniciarAdministracion, limpiarAdministracion } from './administracion.js';
import {
  cerrarSesion,
  consultarAccesoActual,
  iniciarSesionConCorreo,
  obtenerMensajeConfiguracion,
} from './sesion.js';
import { detenerAgendaReal, iniciarAgendaReal } from './agenda-real.js';

const raiz = document.getElementById('pat-access');
const login = document.getElementById('pa-login');
const sinAcceso = document.getElementById('pa-sin-acceso');
const agenda = document.getElementById('pa-agenda');
const formulario = document.getElementById('pa-form');
const campoCorreo = document.getElementById('pa-email');
const campoContrasena = document.getElementById('pa-password');
const botonEntrar = document.getElementById('pa-entrar');
const mensaje = document.getElementById('pa-message');
const resumenSesion = document.getElementById('pa-resumen-sesion');
const etiquetaEmpresa = document.getElementById('pa-empresa-identificada');
const botonCerrar = document.getElementById('pa-logout');
const botonVolver = document.getElementById('pa-back');

function mostrar(seccion) {
  login.hidden = seccion !== 'login';
  sinAcceso.hidden = seccion !== 'sin-acceso';
  agenda.hidden = seccion !== 'agenda';
}

function pintarMensaje(texto, esError = false) {
  mensaje.textContent = texto || '';
  mensaje.classList.toggle('pa-aviso-error', Boolean(esError && texto));
}

function prepararBarraAgenda({ identificada }) {
  botonCerrar.hidden = !identificada;
  botonVolver.hidden = identificada;
}

function aplicarAcceso(acceso) {
  limpiarAdministracion();
  detenerAgendaReal();
  if (!acceso.usuario) {
    mostrar('login');
    return;
  }

  if (!acceso.membresia) {
    mostrar('sin-acceso');
    return;
  }

  const empresa = acceso.membresia.empresa?.nombre || 'Empresa';
  resumenSesion.replaceChildren();
  const nombre = document.createElement('strong'); nombre.textContent = acceso.membresia.nombre;
  const detalle = document.createElement('span'); detalle.textContent = `${acceso.membresia.rol} · ${empresa}`;
  resumenSesion.append(nombre, detalle);
  etiquetaEmpresa.textContent = `Agenda real · ${empresa}`;
  const companyEl = document.querySelector('#visita-app .v-company');
  if (companyEl) companyEl.textContent = empresa;
  prepararBarraAgenda({ identificada: true });
  iniciarAgendaReal(acceso);
  mostrar('agenda');
  iniciarAdministracion(acceso).catch(() => pintarMensaje('No se pudo cargar la administración.', true));
}

async function intentarCerrarSesion() {
  try {
    await cerrarSesion();
    limpiarAdministracion();
    detenerAgendaReal();
    formulario.reset();
    pintarMensaje('Sesión cerrada.');
    mostrar('login');
  } catch (error) {
    pintarMensaje(error.message, true);
  }
}

export async function arrancarInterfaz() {
  const avisoConfig = obtenerMensajeConfiguracion();
  if (avisoConfig) {
    pintarMensaje(avisoConfig, true);
    botonEntrar.disabled = true;
    mostrar('login');
    return;
  }

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    pintarMensaje('Comprobando tu acceso…');
    botonEntrar.disabled = true;
    const contrasena = campoContrasena.value;
    try {
      const acceso = await iniciarSesionConCorreo(campoCorreo.value, contrasena);
      campoContrasena.value = '';
      pintarMensaje('');
      aplicarAcceso(acceso);
    } catch (error) {
      campoContrasena.value = '';
      pintarMensaje(error.message, true);
    } finally {
      botonEntrar.disabled = false;
    }
  });

  document.getElementById('pa-reveal').addEventListener('click', (evento) => {
    const mostrarTexto = campoContrasena.type === 'password';
    campoContrasena.type = mostrarTexto ? 'text' : 'password';
    evento.currentTarget.textContent = mostrarTexto ? 'Ocultar' : 'Mostrar';
    evento.currentTarget.setAttribute('aria-pressed', String(mostrarTexto));
  });

  document.getElementById('pa-reset').addEventListener('click', () => {
    pintarMensaje(
      'La recuperación de contraseña todavía no está activa. Escríbele a tu administrador para que te ayude a restablecerla. No se ha enviado ningún mensaje.',
    );
  });

  document.getElementById('pa-back').addEventListener('click', () => {
    pintarMensaje('');
    mostrar('login');
  });

  document.getElementById('pa-logout').addEventListener('click', intentarCerrarSesion);
  document.getElementById('pa-salir-sin-acceso').addEventListener('click', intentarCerrarSesion);

  try {
    pintarMensaje('Comprobando si ya hay una sesión…');
    const acceso = await consultarAccesoActual();
    pintarMensaje('');
    aplicarAcceso(acceso);
  } catch (error) {
    pintarMensaje(error.message, true);
    mostrar('login');
  }
}

raiz.dataset.listo = 'si';
