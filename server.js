const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuración CORS para Vercel
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Estado de las salas
const rooms = new Map();

// Estructura de una sala
class Room {
  constructor(id) {
    this.id = id;
    this.users = new Map();
    this.host = null;
    this.videoState = {
      url: '',
      playing: false,
      currentTime: 0,
      lastUpdate: Date.now()
    };
    this.messages = [];
  }

  addUser(socketId, username) {
    this.users.set(socketId, {
      id: socketId,
      username: username,
      isHost: this.host === null,
      micMuted: false,
      avatar: this.getRandomAvatar()
    });
    
    if (this.host === null) {
      this.host = socketId;
    }
    
    return this.users.get(socketId);
  }

  removeUser(socketId) {
    this.users.delete(socketId);
    
    // Si el host se va, asignar nuevo host
    if (this.host === socketId && this.users.size > 0) {
      this.host = this.users.keys().next().value;
      const newHost = this.users.get(this.host);
      newHost.isHost = true;
    }
  }

  getRandomAvatar() {
    const colors = ['#7289da', '#43b581', '#faa61a', '#f04747', '#9b59b6'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

io.on('connection', (socket) => {
  console.log('✅ Usuario conectado:', socket.id);

  // Unirse a una sala
  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Room(roomId));
    }
    
    const room = rooms.get(roomId);
    const user = room.addUser(socket.id, username);
    
    // Enviar estado actual al nuevo usuario
    socket.emit('room-state', {
      videoState: room.videoState,
      users: Array.from(room.users.values()),
      messages: room.messages,
      userId: socket.id
    });
    
    // Notificar a todos los demás
    socket.to(roomId).emit('user-joined', user);
    
    console.log(`👤 ${username} se unió a la sala ${roomId}`);
  });

  // Cambiar URL del video (solo host)
  socket.on('video-url-change', ({ roomId, url }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const user = room.users.get(socket.id);
    if (!user || !user.isHost) {
      socket.emit('error', 'Solo el host puede cambiar el video');
      return;
    }
    
    room.videoState.url = url;
    room.videoState.currentTime = 0;
    room.videoState.playing = false;
    room.videoState.lastUpdate = Date.now();
    
    io.to(roomId).emit('video-url-changed', room.videoState);
    console.log(`📺 Video cambiado en sala ${roomId}: ${url}`);
  });

  // Sincronizar reproducción
  socket.on('video-play', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.videoState.playing = true;
    room.videoState.currentTime = currentTime;
    room.videoState.lastUpdate = Date.now();
    
    socket.to(roomId).emit('video-play', { currentTime });
  });

  socket.on('video-pause', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.videoState.playing = false;
    room.videoState.currentTime = currentTime;
    room.videoState.lastUpdate = Date.now();
    
    socket.to(roomId).emit('video-pause', { currentTime });
  });

  socket.on('video-seek', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.videoState.currentTime = currentTime;
    room.videoState.lastUpdate = Date.now();
    
    socket.to(roomId).emit('video-seek', { currentTime });
  });

  // Chat de texto
  socket.on('chat-message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const user = room.users.get(socket.id);
    if (!user) return;
    
    const chatMessage = {
      id: Date.now(),
      username: user.username,
      text: message,
      timestamp: new Date().toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      avatar: user.avatar
    };
    
    room.messages.push(chatMessage);
    
    // Limitar a 100 mensajes
    if (room.messages.length > 100) {
      room.messages.shift();
    }
    
    io.to(roomId).emit('chat-message', chatMessage);
  });

  // Mutear micrófono
  socket.on('toggle-mic', ({ roomId, muted }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const user = room.users.get(socket.id);
    if (!user) return;
    
    user.micMuted = muted;
    
    io.to(roomId).emit('user-mic-toggle', {
      userId: socket.id,
      muted: muted
    });
  });

  // WebRTC Signaling (Voice)
  socket.on('webrtc-offer', ({ roomId, to, offer }) => {
    socket.to(to).emit('webrtc-offer', {
      from: socket.id,
      offer: offer
    });
  });

  socket.on('webrtc-answer', ({ roomId, to, answer }) => {
    socket.to(to).emit('webrtc-answer', {
      from: socket.id,
      answer: answer
    });
  });

  socket.on('webrtc-ice-candidate', ({ roomId, to, candidate }) => {
    socket.to(to).emit('webrtc-ice-candidate', {
      from: socket.id,
      candidate: candidate
    });
  });

  // Screen Share Signaling
  socket.on('screen-share-offer', ({ roomId, to, offer }) => {
    socket.to(to).emit('screen-share-offer', {
      from: socket.id,
      offer: offer
    });
  });

  socket.on('screen-share-answer', ({ roomId, to, answer }) => {
    socket.to(to).emit('screen-share-answer', {
      from: socket.id,
      answer: answer
    });
  });

  socket.on('screen-share-ice-candidate', ({ roomId, to, candidate }) => {
    socket.to(to).emit('screen-share-ice-candidate', {
      from: socket.id,
      candidate: candidate
    });
  });

  socket.on('screen-share-stopped', ({ roomId }) => {
    socket.to(roomId).emit('screen-share-stopped');
    console.log('📺 Screen share detenido en sala', roomId);
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('❌ Usuario desconectado:', socket.id);
    
    // Buscar y eliminar de todas las salas
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        const user = room.users.get(socket.id);
        room.removeUser(socket.id);
        
        socket.to(roomId).emit('user-left', {
          userId: socket.id,
          newHost: room.host
        });
        
        console.log(`👋 ${user.username} salió de la sala ${roomId}`);
        
        // Eliminar sala si está vacía
        if (room.users.size === 0) {
          rooms.delete(roomId);
          console.log(`🗑️  Sala ${roomId} eliminada (vacía)`);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   🎬 Watch Party Server - Iniciado    ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`🌐 Servidor corriendo en: http://localhost:${PORT}`);
  console.log(`🔌 WebSockets: Activo`);
  console.log(`📁 Archivos estáticos: /public`);
  console.log('');
  console.log('Presiona Ctrl+C para detener el servidor');
  console.log('------------------------------------------');
});