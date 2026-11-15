/**
 * Sonda de entrada para los fallos por foco o por texto perdido.
 *
 * Devuelve una expresión de `Runtime.evaluate` que lee lo que no se registraba en
 * los mensajes de espera: si el documento tiene el foco, el valor y la selección
 * de la barra de direcciones y si su lista de sugerencias está desplegada. Solo
 * lee el DOM: no toca ni el estado ni la lógica de la app.
 */
export function inputProbeExpression(addressSelector) {
  return `(() => {
    const address = document.querySelector(${JSON.stringify(addressSelector)});
    const list = document.getElementById('terminus-address-suggestions');
    return {
      hasFocus: document.hasFocus(),
      address: address
        ? { value: address.value, selStart: address.selectionStart, selEnd: address.selectionEnd }
        : null,
      suggestionsOpen: Boolean(list) && list.getClientRects().length > 0,
    };
  })()`;
}
