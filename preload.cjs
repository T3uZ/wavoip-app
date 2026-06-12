const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
    // Janela
    incomingCall: () => ipcRenderer.send("incoming-call"),
    callEnded:    () => ipcRenderer.send("call-ended"),

    // Auth
    auth: {
        login:        (email, senha)           => ipcRenderer.invoke("auth:login", email, senha),
        logout:       (token)                  => ipcRenderer.invoke("auth:logout", token),
        check:        (token)                  => ipcRenderer.invoke("auth:check", token),
        alterarSenha: (token, atual, nova)     => ipcRenderer.invoke("auth:alterar-senha", token, atual, nova),
        meusTokens:   (token)                  => ipcRenderer.invoke("auth:meus-tokens", token),
    },

    // Admin — Usuários
    adminUsuarios: {
        listar:       (token)                            => ipcRenderer.invoke("admin:usuarios:listar", token),
        criar:        (token, nome, email, senha, tipo)  => ipcRenderer.invoke("admin:usuarios:criar", token, nome, email, senha, tipo),
        atualizar:    (token, id, nome, email, tipo, at) => ipcRenderer.invoke("admin:usuarios:atualizar", token, id, nome, email, tipo, at),
        resetarSenha: (token, id, senha)                 => ipcRenderer.invoke("admin:usuarios:resetar-senha", token, id, senha),
        deletar:      (token, id)                        => ipcRenderer.invoke("admin:usuarios:deletar", token, id),
    },

    // Admin — Tokens
    adminTokens: {
        listar:    (token)                       => ipcRenderer.invoke("admin:tokens:listar", token),
        criar:     (token, nome, tk)             => ipcRenderer.invoke("admin:tokens:criar", token, nome, tk),
        atualizar: (token, id, nome, tk, ativo)  => ipcRenderer.invoke("admin:tokens:atualizar", token, id, nome, tk, ativo),
        deletar:   (token, id)                   => ipcRenderer.invoke("admin:tokens:deletar", token, id),
    },

    // Admin — Vínculos
    adminVinculos: {
        doUsuario:   (token, uid)      => ipcRenderer.invoke("admin:vinculos:do-usuario", token, uid),
        vincular:    (token, uid, tid) => ipcRenderer.invoke("admin:vinculos:vincular", token, uid, tid),
        desvincular: (token, uid, tid) => ipcRenderer.invoke("admin:vinculos:desvincular", token, uid, tid),
    },

    // Sync multi-device
    chamadas: {
        notificar: (token, phone) => ipcRenderer.invoke("chamada:notificar", token, phone),
        verificar: (token, phone) => ipcRenderer.invoke("chamada:verificar", token, phone),
    },

    // Contatos
    contatos: {
        listar:    (token)                  => ipcRenderer.invoke("contatos:listar", token),
        criar:     (token, nome, numero)    => ipcRenderer.invoke("contatos:criar", token, nome, numero),
        atualizar: (token, id, nome, num)   => ipcRenderer.invoke("contatos:atualizar", token, id, nome, num),
        deletar:   (token, id)              => ipcRenderer.invoke("contatos:deletar", token, id),
    },

    // Registros
    registros: {
        inserir:   (token, tipo, numero, nome)    => ipcRenderer.invoke("registros:inserir", token, tipo, numero, nome),
        finalizar: (token, id, dur, atendida)     => ipcRenderer.invoke("registros:finalizar", token, id, dur, atendida),
        listar:    (token, limite)                => ipcRenderer.invoke("registros:listar", token, limite),
        stats:     (token)                        => ipcRenderer.invoke("registros:stats", token),
    },
})
