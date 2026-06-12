import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electronAPI", {
    incomingCall: () => ipcRenderer.send("incoming-call"),
    callEnded:    () => ipcRenderer.send("call-ended"),
})
