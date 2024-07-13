import Channel from '@thaunknown/simple-peer/lite.js'
import {hex2bin, bin2hex} from 'uint8-util'
import Events from 'events'

export default class Trystereo extends Events {
    constructor(url, hash, max = 6, min = 3, opts){
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
        if(!max || max <= min || max > 6){
            throw new Error('max is incorrect')
        }
        this.max = max
        if((min) && (min >= max || min < 1)){
            throw new Error('min is incorrect')
        }
        this.min = min
        this.wsOffers = new Map()
        this.channels = new Map()
        this.socket = null
        // this.relay = false
        this.announceSeconds = opts.announceSeconds || 33 * 1000
        this.maxAnnounceSecs = opts.maxAnnounceSecs || 120 * 1000
        this.ws()
        this.timerWS = setInterval(() => {this.ws()}, this.announceSeconds)
        this.alternativeSeconds = 60 * 1000
    }
    quit(){
        this.wsOffers.forEach((data) => {
            data.destroy()
        })
        this.channels.forEach((data) => {
            data.destroy()
        })
        if(this.timerWS){
            clearInterval(this.timerWS)
        }
        if(this.socket){
            this.socket.close()
        }
        Object.keys(this).forEach((data) => {
            if(this[data] !== 'quit'){
                this[data] = null
            }
        })
    }
    initWS(){
        if(this.channels.size < this.max){
            const check = this.max - this.channels.size
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
            this.wsOffers.forEach((data) => {
                data.destroy((err) => {
                    console.error(err)
                })
            })
            this.wsOffers.clear()
        }
    }
    ws(){
        if(this.min && this.channels.size >= this.min){
            this.wsOffers.forEach((data) => {
                data.destroy((err) => {
                    console.error(err)
                })
            })
            this.wsOffers.clear()
            return
        }
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

            if(this.channels.size >= this.max){
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
            if(message.interval && message.interval > this.announceSeconds && message.interval <= this.maxAnnounceSecs) {
                clearInterval(this.timerWS)
                this.announceSecs = message.interval * 1000
                this.timerWS = setInterval(() => {this.ws()}, this.announceSecs)
            }
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
            console.error(e)
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
                this.channels.forEach((data) => {
                    if(data.id !== channel.id){
                        data.send(JSON.stringify({type: 'channels', method: 'add', id: channel.id}))
                        channel.send(JSON.stringify({type: 'channels', method: 'add', id: data.id}))
                    }
                })
            }
            this.emit('connect', channel)
            // channel.emit('connected', channel)
        }
        const onData = (data) => {
            // this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: data}}))
            let msg
            try {
                msg = JSON.parse(new TextDecoder("utf-8").decode(data))
            } catch (error) {
                console.error(error)
                return
            }
            // channel.emit('message', msg.user, msg.relay, msg.data)
            this.emit('message', msg)
            if(msg.type){
                this.channels.forEach((chan) => {
                    if(chan.id !== channel.id && !channel.channels.includes(chan.id) && !chan.channels.includes(channel.id)){
                        chan.send(JSON.stringify({user: msg.user, relay: this.id, data: msg.data}))
                    }
                })
            }
            // handle msg
        }
        // const onStream = (stream) => {
        //     this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: stream}}))
        // }
        // const onTrack = (track, stream) => {
        //     this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: {track, stream}}}))
        // }
        const onError = (err) => {
            this.emit('error', channel.id, err)
        }
        const onClose = () => {
            // this.dispatchEvent(new CustomEvent('close', {detail: channel}))
            onHandle()
            if(this.channels.has(channel.id)){
                this.channels.delete(channel.id)
            }
            this.emit('disconnect', channel)
            // channel.emit('disconnected', channel)
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
    message(type, data){
        const meta = {user: this.id, relay: null, type, data}
        this.channels.forEach((prop) => {
            prop.send(JSON.stringify(meta))
        })
    }
}