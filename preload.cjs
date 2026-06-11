const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
    // Janela
    incomingCall: () => ipcRenderer.send("incoming-call"),
    callEnded:    () => ipcRenderer.send("call-ended"),

    // Contatos
    contatos: {
        listar:     ()                     => ipcRenderer.invoke("contatos:listar"),
        criar:      (nome, numero)         => ipcRenderer.invoke("contatos:criar", nome, numero),
        atualizar:  (id, nome, numero)     => ipcRenderer.invoke("contatos:atualizar", id, nome, numero),
        deletar:    (id)                   => ipcRenderer.invoke("contatos:deletar", id),
    },

    // Registros
    registros: {
        inserir:    (tipo, numero, nome)   => ipcRenderer.invoke("registros:inserir", tipo, numero, nome),
        finalizar:  (id, duracao, atendida)=> ipcRenderer.invoke("registros:finalizar", id, duracao, atendida),
        listar:     (limite)               => ipcRenderer.invoke("registros:listar", limite),
        stats:      ()                     => ipcRenderer.invoke("registros:stats"),
    },
})
