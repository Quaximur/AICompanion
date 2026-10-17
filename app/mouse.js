// Состояние левой кнопки мыши напрямую из Windows. События мыши в прозрачном окне
// Electron теряются (курсор выскочил за окно, сброс захвата), а системе можно доверять.

const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
const SM_SWAPBUTTON = 23;

function createButtonReader() {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const getAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
    const getSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)');
    // GetAsyncKeyState смотрит на физические кнопки: у левшей «левая» — это VK_RBUTTON
    return () => {
      const key = getSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON;
      return (getAsyncKeyState(key) & 0x8000) !== 0;
    };
  } catch (err) {
    console.error('Не удалось подключить user32 через koffi, перетаскивание завершится по событию окна:', err.message);
    return null;
  }
}

module.exports = { isPrimaryButtonDown: createButtonReader() };
