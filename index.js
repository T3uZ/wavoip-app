import { Wavoip } from "@wavoip/wavoip-api"

const wavoip = new Wavoip({
    tokens: ["c0f1b757-7e60-401e-be69-a4caebefec54"],
    platform: "my-app",
})

// Mostra status dos dispositivos
const devices = wavoip.getDevices()
console.log("Dispositivos conectados:", devices.length)

for (const device of devices) {
    device.on("statusChanged", (status) => {
        console.log("Status do dispositivo:", status)
    })

    device.on("qrCodeChanged", (qrCode) => {
        if (qrCode) {
            console.log("QR Code para escanear:", qrCode)
        }
    })
}

// Receber chamadas
wavoip.on("offer", async (offer) => {
    console.log("Chamada recebida de:", offer.peer?.phone)

    const { call, err } = await offer.accept()
    if (err) {
        console.error("Erro ao aceitar chamada:", err)
        return
    }

    call.on("ended", () => console.log("Chamada encerrada"))
})

console.log("WaVoIP iniciado. Aguardando chamadas...")
