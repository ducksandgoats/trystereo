import Channel from '@thaunknown/simple-peer/lite.js'
import {hex2bin, bin2hex} from 'uint8-util'

export default class Trystereo extends EventTarget {
    constructor(url, hash, limit = 6, opts){
        super()
        if(localStorage.getItem('id')){
            this.id = localStorage.getItem('id')
        } else {
            this.id = Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => {return ('0' + byte.toString(16)).slice(-2)}).join('')
            localStorage.setItem('id', this.id)
        }
        this.charset = '0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz'
        this.url = url
        this.hash = hash
        this.limit = limit || 2
        if(this.limit > 6){
            throw new Error('Limit can not be above 6')
        }
        this.rtcOffers = new Map()
        this.wsOffers = new Map()
        this.channels = new Map()
        this.socket = null
        // this.relay = false
        this.announceSeconds = opts.announceSeconds || 33
        this.maxAnnounceSecs = opts.maxAnnounceSecs || 120
        this.ws()
        this.timerWS = setInterval(() => {this.ws()}, 120000)
        this.timerWRTC = setInterval(() => {this.wrtc()}, 60000)
    }
    initWRTC(){
        if(this.channels.size < this.limit){
            const check = this.limit - this.channels.size
            if(this.rtcOffers.size < check){
                const test = check - this.rtcOffers.size
                for(let i = 0;i < test;i++){
                    const testID = Array(20).fill().map(() => {return this.charset[Math.floor(Math.random() * this.charset.length)]}).join('')
                    const testChannel = new Channel({initiator: true, trickle: false})
                    testChannel.offer_id = testID
                    testChannel.offer = new Promise((res) => testChannel.once('signal', res))
                    testChannel.channels = new Set()
                    testChannel.relay = false
                    testChannel.timer = setTimeout(() => {
                        clearTimeout(testChannel.timer)
                        testChannel.destroy((err) => {
                            console.error(err)
                        })
                        this.rtcOffers.delete(testID)
                    }, 60000)
                    this.rtcOffers.set(testID, testChannel)
                }
            }
        } else {
            this.rtcOffers.forEach((data) => {
                clearTimeout(data.timer)
                data.destroy((err) => {
                    console.error(err)
                })
            })
            this.rtcOffers.clear()
            this.wsOffers.forEach((data) => {
                data.destroy((err) => {
                    console.error(err)
                })
            })
            this.wsOffers.clear()
        }
    }
    initWS(){
        if(this.channels.size < this.limit){
            const check = this.limit - this.channels.size
            if(this.wsOffers.size < check){
                const test = check - this.wsOffers.size
                for(let i = 0;i < test;i++){
                    const testID = Array(20).fill().map(() => {return this.charset[Math.floor(Math.random() * this.charset.length)]}).join('')
                    const testChannel = new Channel({initiator: true, trickle: false})
                    testChannel.offer_id = testID
                    testChannel.offer = new Promise((res) => testChannel.once('signal', res))
                    testChannel.channels = new Set()
                    this.wsOffers.set(testID, testChannel)
                }
            }
        } else {
            this.rtcOffers.forEach((data) => {
                clearTimeout(data.timer)
                data.destroy((err) => {
                    console.error(err)
                })
            })
            this.rtcOffers.clear()
            this.wsOffers.forEach((data) => {
                data.destroy((err) => {
                    console.error(err)
                })
            })
            this.wsOffers.clear()
        }
    }
    wrtc(){
        this.initWRTC()
        if(!this.rtcOffers.size){
            return
        };
        (async () => {
            // for(const chan of this.channels.values()){
            //     for(const data of this.rtcOffers.values()){
            //         chan.send({offer_id: data.offer_id, offer: await Promise.resolve(data.offer)})
            //     }
            // }
            const arr = []
            for(const data of this.rtcOffers.values()){
                arr.push({offer_id: data.offer_id, offer: await Promise.resolve(data.offer)})
            }
            return arr
        })()
        .then((offers) => {
            if(offers.length){
                this.channels.forEach((chan) => {
                    offers.forEach((data) => {
                        chan.send(JSON.stringify({offer_id: data.offer_id, action: 'signal', method: 'relay', status: false, shake: false}))
                    })
                })
            }
        })
        .catch((err) => {
            console.error(err)
        });
    }
    ws(){
        this.initWS()
        if(!this.wsOffers.size){
            return
        }
        if(this.socket){
            if(this.socket.readyState === WebSocket.OPEN){
                console.log('connected');
                (async () => {
                    const arr = [];
                    for(const val of this.wsOffers.values()){
                        arr.push({offer_id: val.offer_id, offer: await Promise.resolve(val.offer)});
                    };
                    return arr
                })()
                .then((data) => {
                    if(data.length){
                        this.socket.send(JSON.stringify({
                            action: 'announce',
                            info_hash: hex2bin(this.hash),
                            numwant: data.length,
                            peer_id: hex2bin(this.id),
                            offers: data
                        }))
                    }
                })
                .catch((e) => {
                    console.error(e)
                });
            } else if(this.socket.readyState === WebSocket.CONNECTING){
                console.log('connecting')
                // notify it is connecting by emitting a connecting event with connecting string
            } else {
                delete this.socket
                this.soc()
            }
        } else {
            this.soc()
        }
    }
    soc(){
        this.socket = new WebSocket(this.url)
        const handleOpen = (e) => {
            console.log(e);
            // this.relay = true
            (async () => {
                const arr = [];
                for(const val of this.wsOffers.values()){
                    arr.push({offer_id: val.offer_id, offer: await Promise.resolve(val.offer)});
                };
                return arr
            })()
            .then((data) => {
                if(data.length){
                    this.socket.send(JSON.stringify({
                        action: 'announce',
                        info_hash: hex2bin(this.hash),
                        numwant: data.length,
                        peer_id: hex2bin(this.id),
                        offers: data
                    }))
                }
            })
            .catch((e) => {
                console.error(e)
            });
        }
        const handleMessage = (e) => {
            console.log(e)
            let message
            try {
                message = JSON.parse(e.data)
            } catch (error) {
                console.error(error)
                return
            }
            // handle message
            const msgInfoHash = message.info_hash ? bin2hex(message.info_hash) : ''
            const msgPeerId = message.peer_id ? bin2hex(message.peer_id) : ''
            // const msgToPeerId = message.to_peer_id ? bin2hex(message.to_peer_id) : ''
            if ((msgPeerId && msgPeerId === this.id) || msgInfoHash !== this.hash){
                return
            }

            if(this.channels.size >= this.limit){
                this.wsOffers.forEach((data) => {data.destroy((err) => {if(err){console.error(err)}})})
                this.wsOffers.clear()
                return
            }

            const errMsg = message['failure reason']

            if (errMsg) {
                console.error(`torrent tracker failure from ${this.socket.url} - ${errMsg}`)
                if(errMsg === 'Relaying'){
                if(message.relay){
                    this.url = message.relay
                    this.socket.close()
                    this.soc()
                }
                }
                return
            }
            // if(message.interval && message.interval > this.announceSeconds && message.interval <= this.maxAnnounceSecs) {
            //     clearInterval(this.announceInterval)
            //     this.announceSecs = message.interval
            //     this.announceInterval = setInterval(this.initWS, this.announceSecs * 1000)
            // }
            if (message.offer && message.offer_id) {
                if (this.channels.has(msgPeerId)){
                    return
                }
            
                const peer = new Channel({initiator: false, trickle: false})
            
                peer.once('signal', (answer) => {this.socket.send(JSON.stringify({ answer, action: 'announce', info_hash: hex2bin(this.hash), peer_id: hex2bin(this.id), to_peer_id: hex2bin(msgPeerId), offer_id: message.offer_id }))})
                peer.channels = new Set()
                peer.signal(message.offer)
                peer.id = msgPeerId
                this.handleChannel(peer)
                return
            }
            if (message.answer) {
                if (this.channels.has(msgPeerId)){
                    return
                }

                if(!this.wsOffers.has(message.offer_id)){
                    return
                }
        
                const offer = this.wsOffers.get(message.offer_id)
                offer.signal(message.answer)
                offer.id = msgPeerId
                this.wsOffers.delete(offer.offer_id)
                this.handleChannel(offer)
            }
        }
        const handleError = (e) => {
            console.log(e)
        }
        const handleClose = (e) => {
            console.log(e)
            // this.relay = false
            handleEvent()
        }
        this.socket.addEventListener('open', handleOpen)
        this.socket.addEventListener('message', handleMessage)
        this.socket.addEventListener('error', handleError)
        this.socket.addEventListener('close', handleClose)
        const handleEvent = () => {
            this.socket.removeEventListener('open', handleOpen)
            this.socket.removeEventListener('message', handleMessage)
            this.socket.removeEventListener('error', handleError)
            this.socket.removeEventListener('close', handleClose)
        }
    }
    handleChannel(channel){
        const onConnect = () => {
            // this.dispatchEvent(new CustomEvent('connect', {detail: channel}))
            if(!this.channels.has(channel.id)){
                this.channels.set(channel.id, channel)
            }
            this.wrtc()
            channel.emit('connected', channel)
        }
        const onData = (data) => {
            // this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: data}}))
            let msg
            try {
                msg = JSON.parse(data)
            } catch (error) {
                console.error(error)
                return
            }
            if(msg.action === 'signal'){
                if(msg.method === 'request'){
                    if(this.channels.size >= this.limit){
                        return
                    }
                    if(msg.shake){
                        const peer = new Channel({initiator: false, trickle: false})
                        peer.once('signal', (answer) => {
                            msg.answer = answer
                            msg.method = 'relay'
                            msg.status = true
                            channel.send(JSON.stringify(msg))
                        })
                        peer.channels = new Set()
                        peer.signal(msg.offer)
                        peer.id = msg.request
                        this.handleChannel(peer)
                    } else {
                        msg.method = 'relay'
                        // msg.response = this.id
                        msg.status = true
                        channel.send(JSON.stringify(msg))
                    }
                } else if(msg.method === 'relay'){
                    if(msg.status){
                        if(msg.shake){
                            msg.method = 'response'
                            if(this.channels.has(msg.request)){
                                this.channels.get(msg.request).send(JSON.stringify(msg))
                            }
                        } else {
                            msg.method = 'response'
                            msg.response = channel.id
                            if(this.channels.has(msg.request)){
                                this.channels.get(msg.request).send(JSON.stringify(msg))
                            }
                        }
                    } else {
                        if(msg.shake){
                            msg.method = 'request'
                            if(this.channels.has(msg.response)){
                                this.channels.get(msg.response).send(JSON.stringify(msg))
                            }
                        } else {
                            const mainData = this.checkSet(channel.channels, channel.id)
                            if(mainData.half){
                                msg.method = 'request'
                                msg.request = channel.id
                                mainData.data.forEach((data) => {
                                    if(this.channels.has(data)){
                                        this.channels.get(data).send(JSON.stringify(msg))
                                    }
                                })
                            }
                        }
                    }
                } else if(msg.method === 'response'){
                    if(msg.shake){
                        if(!this.rtcOffers.has(msg.offer_id)){
                            return
                        }
                        const useOffer = this.rtcOffers.get(msg.offer_id)
                        if(useOffer.relay){
                            return
                        }
                        useOffer.signal(msg.answer)
                        useOffer.id = msg.response
                        this.rtcOffers.delete(useOffer.offer_id)
                        this.handleChannel(useOffer)
                    } else {
                        if(!this.rtcOffers.has(msg.offer_id)){
                            return
                        }
                        const useOffer = this.rtcOffers.get(msg.offer_id)
                        if(useOffer.relay){
                            return
                        }
                        useOffer.relay = true
                        Promise.resolve(useOffer.offer)
                        .then((data) => {
                            msg.offer = data
                            msg.method = 'relay'
                            // msg.response = this.id
                            msg.shake = true
                            msg.status = false
                            channel.send(JSON.stringify(msg))
                        })
                        .catch((err) => {
                            console.error(err)
                        })
                    }
                }
            } else {}
            // handle msg
        }
        // const onStream = (stream) => {
        //     this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: stream}}))
        // }
        // const onTrack = (track, stream) => {
        //     this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: {track, stream}}}))
        // }
        const onError = (err) => {
            console.error(channel.id, err)
        }
        const onClose = () => {
            // this.dispatchEvent(new CustomEvent('close', {detail: channel}))
            onHandle()
            if(this.channels.has(channel.id)){
                this.channels.delete(channel.id)
            }
            this.wrtc()
            channel.emit('disconnected', channel)
        }
        const onHandle = () => {
            channel.off('connect', onConnect)
            channel.off('data', onData)
            // channel.off('stream', onStream)
            // channel.off('track', onTrack)
            channel.off('error', onError)
            channel.off('close', onClose)
        }
        channel.on('connect', onConnect)
        channel.on('data', onData)
        channel.on('error', onError)
        channel.on('close', onClose)
    }
    checkSet(check, main){
        const arr = []
        let num = 0
        this.channels.forEach((data) => {
            if(data.id !== main && !check.has(data.id)){
                arr.push(data.id)
                num++
            }
        })
        return {half: num / check.size < 0.50, data: arr}
    }
    sendData(data){}
}