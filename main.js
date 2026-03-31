const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
if (require('electron-squirrel-startup')) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Esta función obliga a la ventana a "re-despertar" el teclado
ipcMain.on('request-focus', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMinimized()) win.restore(); // Si está minimizada, la restauramos
    win.show(); // La mostramos por si acaso
    win.focus(); // Lo devuelve forzadamente
  }
});
// ---------------------------------------

// GUARDAR PDF
ipcMain.on('exportar-pdf', async (event, suggestedName) => {
  // Cambio: Usamos event.sender para asegurar que pillamos la ventana correcta
  const win = BrowserWindow.fromWebContents(event.sender);
  await new Promise(resolve => setTimeout(resolve, 100));
  
  try {
    const options = {
      marginsType: 0,
      pageSize: 'A4',
      printBackground: true,
      landscape: false,
      scale: 0.8
    };
    const data = await win.webContents.printToPDF(options);
    
    const defaultPath = suggestedName || 'documento.pdf';
    const filePath = dialog.showSaveDialogSync(win, { // Pasamos 'win' para que sea modal
      title: 'Guardar PDF',
      defaultPath: path.join(app.getPath('documents'), defaultPath),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    
    if (filePath) {
      fs.writeFileSync(filePath, data);
      dialog.showMessageBoxSync(win, {
        type: 'info',
        title: 'Éxito',
        message: 'PDF guardado correctamente'
      });
    }
  } catch (error) {
    console.error('Error al generar PDF:', error);
    dialog.showErrorBox('Error', 'No se pudo generar el PDF');
  }
});

// GUARDAR JSON EDITABLE
ipcMain.on('guardar-json', (event, { data, defaultPath }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const filePath = dialog.showSaveDialogSync(win, {
    title: 'Guardar Proyecto Editable',
    defaultPath: path.join(app.getPath('documents'), defaultPath || 'proyecto.json'),
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  
  if (filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      dialog.showMessageBoxSync(win, {
        type: 'info',
        title: 'Éxito',
        message: 'Proyecto guardado correctamente'
      });
    } catch (error) {
      console.error('Error al guardar:', error);
      dialog.showErrorBox('Error', 'No se pudo guardar el archivo');
    }
  }
});