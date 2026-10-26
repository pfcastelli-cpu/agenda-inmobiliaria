// Datos sintéticos para pruebas y vista previa. No corresponden a clientes reales.
export const empresaA = {
  empresa_id: 'empresa-a', nombre_comercial: 'Inmobiliaria Ejemplo A',
  correo_contacto: 'contacto@empresa-a.example', telefono: '', dominio_publico: 'agenda.empresa-a.example',
  contacto_empresa: {
    sitio_web: 'https://empresa-a.example', razon_social: 'Empresa A S.A.S.', nit: '111.111.111-1',
    direccion: 'Dirección ficticia A', politica_datos_url: 'https://empresa-a.example/privacidad',
    correo_baja: 'privacidad@empresa-a.example',
    sedes: [
      { nombre: 'Principal', ciudad: 'Ciudad A', telefonos: [
        { etiqueta: 'Recepción', numero: '+57 601 111 1111', extension: '123' },
        { etiqueta: 'Comercial', numero: '+57 601 111 2222', extension: '' },
      ] },
      { nombre: 'Norte', ciudad: 'Ciudad B', telefonos: [{ etiqueta: '', numero: '+57 605 111 3333', extension: '' }] },
    ],
  },
};
export const empresaB = {
  empresa_id: 'empresa-b', nombre_comercial: 'Inmobiliaria Ejemplo B',
  correo_contacto: 'hola@empresa-b.example', telefono: '', dominio_publico: 'agenda.empresa-b.example',
  contacto_empresa: {
    sitio_web: 'https://empresa-b.example', razon_social: '', nit: '', direccion: '',
    politica_datos_url: '', correo_baja: '',
    sedes: [{ nombre: 'Única', ciudad: 'Ciudad C', telefonos: [{ etiqueta: '', numero: '+57 604 222 2222', extension: '' }] }],
  },
};
