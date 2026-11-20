// Transporte de correo común de todas las funciones (envuelve nodemailer.createTransport).
// MODO «APROBAR EN EL SERVIDOR LOCAL»: si el secreto ENLACES_PRUEBAS_URL tiene valor (ej. http://localhost:5173 o http://192.168.1.20:5173) y el
// correo es de PRUEBAS (lleva el aviso «MODO DE PRUEBAS» y por tanto va solo al destino de pruebas), los botones y enlaces que apuntan al sitio
// real (https://citas.patrimonios.co/...) se reescriben para abrir el servidor local. Las imágenes (/correo/...) NO se tocan: siguen en el sitio real.
// Con el secreto vacío, sin definir, sin vencimiento o vencido (máx. 12 h) no hace nada. Un correo real (sin modo de pruebas) NUNCA se reescribe.
// Lo enciende `npm run aprobar` (pone «URL#vencimiento»). A mano: ENLACES_PRUEBAS_URL="http://localhost:5173#<Date.now()+4h>"
//   Encender:  supabase secrets set ENLACES_PRUEBAS_URL=http://localhost:5173#1999999999999 --project-ref ykiuuxludyonkhywtmgu (ejemplo; poner un vencimiento real)
//   Apagar:    supabase secrets unset ENLACES_PRUEBAS_URL --project-ref ykiuuxludyonkhywtmgu
import nodemailer from 'npm:nodemailer@6.9.16';

const SITIO_REAL = 'https://citas.patrimonios.co';

// deno-lint-ignore no-explicit-any
export function crearTransporte(opciones: any) {
  const transporte = nodemailer.createTransport(opciones);
  try {
    // Formato del secreto: «http://localhost:5173#<vence en ms desde 1970>». Sin vencimiento, o ya vencido, se IGNORA:
    // así un secreto que se quedó encendido por olvido nunca desvía los botones de los correos a un servidor local.
    const [urlCruda, vence] = (Deno.env.get('ENLACES_PRUEBAS_URL') || '').trim().split('#');
    const base = (urlCruda || '').trim().replace(/\/+$/, '');
    const vigente = Number(vence) > Date.now() && Number(vence) < Date.now() + 12 * 3600 * 1000;
    if (vigente && /^https?:\/\/[^\s"'<>]+$/.test(base)) {
      // deno-lint-ignore no-explicit-any
      transporte.use('compile', (mail: any, cb: () => void) => {
        try {
          const html = mail?.data?.html;
          if (typeof html === 'string' && html.includes('MODO DE PRUEBAS')) {
            mail.data.html = html.split(SITIO_REAL).map((trozo: string, i: number) => (i === 0 ? trozo : (trozo.startsWith('/correo/') ? SITIO_REAL : base) + trozo)).join('');
          }
        } catch { /* si algo falla, el correo sale con sus enlaces normales */ }
        cb();
      });
    }
  } catch { /* sin el modo local el correo funciona igual */ }
  return transporte;
}
