const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// MONGODB
const MONGO_URI = process.env.MONGODB_URI || "mongodb+cluster_uri_cua_ban";
mongoose.connect(MONGO_URI).then(() => console.log("MongoDB Connected!")).catch(err => console.error(err));

// SCHEMAS
const UserSchema = new mongoose.Schema({ id: String, username: String, password: String, role: String, teamId: String, token: String });
const TeamSchema = new mongoose.Schema({ id: String, name: String, password: String, leaderId: String, members: [String], wins: { type: Number, default: 0 } });
const MatchSchema = new mongoose.Schema({ id: String, round: Number, teamA: Object, teamB: Object, status: String, bo3Maps: Array, scoreA: Number, scoreB: Number });

const User = mongoose.model('User', UserSchema);
const Team = mongoose.model('Team', TeamSchema);
const Match = mongoose.model('Match', MatchSchema);

// AUTO ADVANCE TO FINAL (M3)
async function checkAndAdvanceBracket() {
    try {
        const r1Matches = await Match.find({ round: 1 }).sort({ id: 1 });
        if (r1Matches.length === 0) return;

        const getWinner = (m) => {
            if (!m || m.status !== 'FINISHED') return { id: 'TBD', name: 'TBD (Chờ Đội Thắng)' };
            return m.scoreA > m.scoreB ? m.teamA : m.teamB;
        };

        const winnerM1 = getWinner(r1Matches[0]);
        const winnerM2 = r1Matches.length > 1 ? getWinner(r1Matches[1]) : { id: 'BYE', name: 'BYE' };

        let finalMatch = await Match.findOne({ id: 'M3', round: 2 });
        if (!finalMatch) {
            finalMatch = new Match({ id: 'M3', round: 2, teamA: winnerM1, teamB: winnerM2, status: 'WAITING', bo3Maps: [], scoreA: 0, scoreB: 0 });
        } else {
            finalMatch.teamA = winnerM1;
            finalMatch.teamB = winnerM2;
        }
        await finalMatch.save();
    } catch (err) { console.error("Lỗi nhánh đấu:", err); }
}

// REST API FOR CS 1.6
app.post('/api/cs/login', async (req, res) => {
    const { token } = req.body;
    const user = await User.findOne({ token: token?.trim().toUpperCase() });
    if (!user) return res.status(404).json({ error: "Invalid token" });

    const team = user.teamId ? await Team.findOne({ id: user.teamId }) : null;
    res.json({ success: true, player: { id: user.id, username: user.username, teamName: team ? team.name : null } });
});

app.post('/api/cs/live-feed', (req, res) => {
    const { type, scoreA, scoreB, details } = req.body;
    // Bắn dữ liệu Realtime Live HUD xuống tất cả các Browser đang mở Web
    io.emit('cs_live_update', { type, scoreA, scoreB, details, timestamp: new Date() });
    res.json({ success: true });
});

app.post('/api/cs/update-map-result', async (req, res) => {
    const { matchId, mapName, winnerTeamId, scoreA, scoreB } = req.body;
    const match = await Match.findOne({ id: matchId });
    if (match) {
        if (winnerTeamId === 'TEAM_A') match.scoreA += 1;
        else match.scoreB += 1;

        if (match.scoreA >= 2 || match.scoreB >= 2) match.status = 'FINISHED';
        await match.save();
        await checkAndAdvanceBracket();
        io.emit('bracket_updated');
    }
    res.json({ success: true });
});

app.get('/api/dashboard', async (req, res) => {
    await checkAndAdvanceBracket();
    const matches = await Match.find();
    const teams = await Team.find();
    res.json({ matches, teams });
});

// SOCKET REALTIME CONNECTION
io.on('connection', (socket) => {
    console.log('Client connected to Live HUD:', socket.id);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`VCT Server running on port ${PORT}`));