function attachPasswordHandler(pdfjsLib, task) {
  task.onPassword = (updatePassword, reason) => {
    const first = reason === pdfjsLib.PasswordResponses?.NEED_PASSWORD;
    const password = prompt(first ? 'Este PDF é protegido por senha. Digite a senha:' : 'Senha incorreta. Tente novamente:');
    if (password == null) task.destroy(); else updatePassword(password);
  };
}
function shouldSkipFallback(error) { return ['InvalidPDFException', 'PasswordException'].includes(error?.name); }
async function readFileBytes(file) {
  if (typeof file.arrayBuffer === 'function') {
    try { return new Uint8Array(await file.arrayBuffer()); } catch (error) { console.warn('arrayBuffer falhou; tentando FileReader', error); }
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}
export async function loadPdfRobust(pdfjsLib, file) {
  let url = null;
  let firstError = null;
  try {
    url = URL.createObjectURL(file);
    const task = pdfjsLib.getDocument({ url, disableRange: true, disableStream: true });
    attachPasswordHandler(pdfjsLib, task);
    return { doc: await task.promise, url };
  } catch (error) {
    firstError = error;
    if (url) URL.revokeObjectURL(url);
    if (shouldSkipFallback(error)) throw error;
    console.warn('Abertura por URL local falhou; tentando leitura direta.', error);
  }
  try {
    const bytes = await readFileBytes(file);
    if (!bytes.length) throw new Error('Arquivo vazio.');
    const task = pdfjsLib.getDocument({ data: bytes });
    attachPasswordHandler(pdfjsLib, task);
    return { doc: await task.promise, url: null };
  } catch (error) {
    error.firstAttempt = firstError;
    throw error;
  }
}
export function friendlyOpenError(error) {
  const name = error?.name || '';
  const message = String(error?.message || '').toLowerCase();
  if (name === 'PasswordException') return 'Este PDF é protegido por senha ou a senha informada não foi aceita.';
  if (name === 'InvalidPDFException' || message.includes('invalid pdf')) return 'O arquivo selecionado não parece ser um PDF válido ou está corrompido.';
  if (name === 'MissingPDFException' || name === 'UnexpectedResponseException' || message.includes('fetch') || message.includes('network') || message.includes('read')) return 'Não consegui ler esse PDF no aparelho. Se ele estiver no iCloud ou Drive, baixe-o para o iPhone e tente novamente.';
  if (name === 'RangeError' || message.includes('memory')) return 'Este PDF é grande demais para a memória disponível. Feche outras abas e tente novamente.';
  return 'Não foi possível abrir este PDF. Tente selecioná-lo novamente.';
}
