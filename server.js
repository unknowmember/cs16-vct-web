const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://admin:XxyYZzz1243123@cluster0.brqqwja.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected Successfully!"))
  .catch(err => console.log("MongoDB Connection Error:", err.message));

// Schemas
const UserSchema = new mongoose.Schema({
    id: String, username: String, password: String, role: String, teamId: String, token: String
});
const TeamSchema = new mongoose.Schema({
    id: String, name: String, password: String, leaderId: String, members: [String], wins: { type: Number, default: 0 }
});
const MatchSchema = new mongoose.Schema({
    id: String, round: Number,
    teamA: Object, teamB: Object,
    status: String,
    bo3Maps: Array,
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 }
});

const User = mongoose.model('User', UserSchema);
const Team = mongoose.model('Team', TeamSchema);
const Match = mongoose.model('Match', MatchSchema);

const MAP_POOL = ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"];

async function initAdmin() {
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
        await User.create({
            id: 'ADMIN_001', username: 'admin',
            password: bcrypt.hashSync('Hoangh@171112', 10),
            role: 'ADMIN', teamId: null,
            token: crypto.randomBytes(10).toString('hex').toUpperCase()
        });
    }
}
initAdmin();

// AUTH
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (await User.findOne({ username })) return res.status(400).json({ error: "Tài khoản đã tồn tại!" });

    const user = await User.create({
        id: Date.now().toString(), username,
        password: await bcrypt.hash(password, 10),
        role: 'USER', teamId: null,
        token: crypto.randomBytes(10).toString('hex').toUpperCase()
    });
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, token: user.token, teamId: null } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, token: user.token, teamId: user.teamId } });
});

// TEAMS
app.get('/api/teams', async (req, res) => {
    const teams = await Team.find();
    const users = await User.find();
    const result = teams.map(t => ({
        id: t.id, name: t.name, leaderId: t.leaderId, wins: t.wins,
        members: users.filter(u => u.teamId === t.id).map(u => ({ id: u.id, username: u.username, isLeader: u.id === t.leaderId }))
    }));
    res.json(result);
});

app.post('/api/team/create', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user || user.teamId) return res.status(400).json({ error: "Tài khoản đã có team!" });

    const team = await Team.create({
        id: 'TEAM_' + Date.now(), name: teamName,
        password: await bcrypt.hash(teamPassword, 10),
        leaderId: user.id, // Đội trưởng là người tạo
        members: [user.id]
    });

    user.teamId = team.id;
    await user.save();
    res.json({ success: true, team });
});

app.post('/api/team/join', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = await User.findOne({ id: userId });
    const team = await Team.findOne({ name: teamName });

    if (!user || !team || !(await bcrypt.compare(teamPassword, team.password))) {
        return res.status(400).json({ error: "Thông tin sai!" });
    }

    user.teamId = team.id;
    if (!team.members.includes(user.id)) team.members.push(user.id);
    await user.save();
    await team.save();
    res.json({ success: true, team });
});

// MATCH & DASHBOARD
app.get('/api/dashboard', async (req, res) => {
    const matches = await Match.find();
    const teams = await Team.find();
    res.json({ matches, teams });
});

app.post('/api/admin/setup-bracket', async (req, res) => {
    const { userId, pairings } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin có quyền!' });

    await Match.deleteMany({});

    const teams = await Team.find();
    const newMatches = [];

    for (let idx = 0; idx < pairings.length; idx++) {
        const pair = pairings[idx];
        const teamA = teams.find(t => t.id === pair.teamAId) || { id: 'BYE_A', name: 'BYE' };
        const teamB = teams.find(t => t.id === pair.teamBId) || { id: 'BYE_B', name: 'BYE' };

        newMatches.push({
            id: `M${idx + 1}`, round: 1,
            teamA, teamB,
            status: 'WAITING',
            bo3Maps: [], scoreA: 0, scoreB: 0
        });
    }

    await Match.insertMany(newMatches);
    res.json({ success: true });
});

app.post('/api/admin/start-match', async (req, res) => {
    const { userId, matchId } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Chỉ Admin!' });

    const match = await Match.findOne({ id: matchId });
    if (!match) return res.status(404).json({ error: "Trận không tồn tại!" });

    match.status = 'PICKING_MAP1';
    await match.save();
    res.json({ success: true, match });
});

// CHECK ĐỘI TRƯỞNG KHI PICK MAP 1
app.post('/api/match/pick-map1', async (req, res) => {
    const { userId, matchId, map1, sideA1 } = req.body;
    const user = await User.findOne({ id: userId });
    const match = await Match.findOne({ id: matchId });
    const teamA = await Team.findOne({ id: match.teamA.id });

    if (!user || !teamA) return res.status(403).json({ error: "Lỗi người dùng!" });
    if (teamA.leaderId !== user.id) return res.status(403).json({ error: "Chỉ ĐỘI TRƯỞNG của Team A mới có quyền Pick Map!" });
    if (match.status !== 'PICKING_MAP1') return res.status(400).json({ error: "Chưa tới lượt chọn Map 1!" });

    match.bo3Maps = [{
        mapIndex: 1, name: map1, picker: match.teamA.name,
        sideA: sideA1, sideB: sideA1 === 'CT' ? 'TERRORIST' : 'CT'
    }];
    match.status = 'PICKING_MAP2';
    await match.save();
    res.json({ success: true, match });
});

// CHECK ĐỘI TRƯỞNG KHI PICK MAP 2
app.post('/api/match/pick-map2', async (req, res) => {
    const { userId, matchId, map2, sideB2 } = req.body;
    const user = await User.findOne({ id: userId });
    const match = await Match.findOne({ id: matchId });
    const teamB = await Team.findOne({ id: match.teamB.id });

    if (!user || !teamB) return res.status(403).json({ error: "Lỗi người dùng!" });
    if (teamB.leaderId !== user.id) return res.status(403).json({ error: "Chỉ ĐỘI TRƯỞNG của Team B mới có quyền Pick Map!" });
    if (match.status !== 'PICKING_MAP2') return res.status(400).json({ error: "Chưa tới lượt chọn Map 2!" });

    const map1Name = match.bo3Maps[0].name;
    if (map1Name === map2) return res.status(400).json({ error: "Map 2 không được trùng với Map 1!" });

    const map2Info = {
        mapIndex: 2, name: map2, picker: match.teamB.name,
        sideA: sideB2 === 'CT' ? 'TERRORIST' : 'CT', sideB: sideB2
    };

    const remainingMaps = MAP_POOL.filter(m => m !== map1Name && m !== map2);
    const deciderMapName = remainingMaps[Math.floor(Math.random() * remainingMaps.length)];
    const sideA3 = Math.random() < 0.5 ? 'CT' : 'TERRORIST';

    const map3Info = {
        mapIndex: 3, name: deciderMapName, picker: "DECIDER (Random)",
        sideA: sideA3, sideB: sideA3 === 'CT' ? 'TERRORIST' : 'CT'
    };

    match.bo3Maps.push(map2Info, map3Info);
    match.status = 'READY';
    await match.save();
    res.json({ success: true, match });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VCT BO3 Server running on port ${PORT}`));