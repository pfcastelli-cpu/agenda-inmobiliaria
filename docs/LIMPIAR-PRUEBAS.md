# Cómo reconocer y limpiar el rastro de las pruebas

## Regla para crear pruebas (Claude Code, Codex y personas)
Toda cita creada para probar el sistema lleva:
- `agenda_citas.es_prueba = true` (SQL 020), y
- el nombre del cliente empieza por **`[PRUEBA] `**.

En la agenda se ve la insignia amarilla «PRUEBA». Las pruebas de Claude hechas antes del 26-oct-2026 («Prueba Claude …», «Cliente de Prueba») quedaron marcadas con la 020.
No son pruebas de Claude y NO se marcaron: las de Felipe («Pepe», «Gino», «Felipe Castelli», «Pedro Interesado»…); se pueden marcar a mano cuando se decida.

Otro rastro de pruebas que NO cuelga de una cita:
- Inmueble Nº 999901 «PRUEBA» y su fila en `agenda_arrendatarios` (22-oct).
- Franjas de prueba en `agenda_inmueble_ventanas` (las pruebas las borraron).
- Citas marcadas para Rentando 127 con el correo de pruebas pf.castelli@patrimonios.co.

## Qué se genera por cada cita de prueba (todo se enlaza por `cita_id`)
`agenda_citas_historial`, `agenda_correos_log`, `agenda_encuestas_cliente`, `agenda_cita_propuestas`, `agenda_arrendatario_acciones`.

## Ver qué hay (solo lectura)
```sql
select id, fecha, estado, cliente_nombre from public.agenda_citas where es_prueba order by fecha desc;
select count(*) from public.agenda_correos_log l join public.agenda_citas c on c.id = l.cita_id where c.es_prueba;
```

## Borrarlo (SOLO con permiso explícito de Felipe; hacer antes un respaldo en `respaldos/`)
Borrar en este orden, dentro de una sola transacción, y revisar los conteos antes de confirmar:
```sql
begin;
delete from public.agenda_correos_log           where cita_id in (select id from public.agenda_citas where es_prueba);
delete from public.agenda_encuestas_cliente     where cita_id in (select id from public.agenda_citas where es_prueba);
delete from public.agenda_cita_propuestas       where cita_id in (select id from public.agenda_citas where es_prueba);
delete from public.agenda_arrendatario_acciones where cita_id in (select id from public.agenda_citas where es_prueba);
delete from public.agenda_citas_historial       where cita_id in (select id from public.agenda_citas where es_prueba);
delete from public.agenda_citas                 where es_prueba;
-- commit;   -- cambiar por commit solo después de revisar; si algo no cuadra: rollback;
```
El informe del propietario muestra la opinión y la nota de las citas «realizadas»: si alguna prueba quedó realizada (p. ej. «Prueba Claude 5», inmueble 127), desaparece de ese informe al borrarla.
