require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

// ---------- Configuration upload ----------
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// ---------- MODÈLES ----------
const companySchema = new mongoose.Schema({
    name: { type: String, default: "Ship'Log Express" },
    logo: { type: String, default: "" },
    tauxUSDToHTG: { type: Number, default: 130 },
    prixParLivre: { type: Number, default: 2.5 },
    fraisFixe: { type: Number, default: 5 },
    superviseurActif: { type: Boolean, default: true }
});
const Company = mongoose.model('Company', companySchema);

const userSchema = new mongoose.Schema({
    nom: { type: String, required: true },
    bureauNom: { type: String, required: true },
    adresse: String,
    email: String,
    role: { type: String, enum: ['receveur', 'livreur', 'superviseur', 'investisseur', 'admin'], required: true },
    code: { type: String, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

const paiementSchema = new mongoose.Schema({
    effectue: { type: Boolean, default: false },
    montantRecu: Number,
    devise: { type: String, enum: ['USD', 'HTG'] },
    moyen: String,
    photoCNI: String,
    photoColisLivraison: String
});
const destinataireSchema = new mongoose.Schema({
    nom: String,
    adresse: String,
    telephone: String,
    cni: String
});
const colisSchema = new mongoose.Schema({
    numeroSuivi: { type: String, unique: true },
    bureauEnvoiId: String,
    bureauEnvoiNom: String,
    bureauLivreurId: String,
    bureauLivreurNom: String,
    expediteurNom: String,
    destinataire: destinataireSchema,
    poidsLivre: Number,
    prixUsd: Number,
    prixGourdes: Number,
    photoColis: String,
    confirme: { type: Boolean, default: false },
    statut: { type: String, enum: ['En attente', 'En transit', 'Arrivé', 'Livré'], default: 'En attente' },
    paiement: paiementSchema,
    dateEnvoi: { type: Date, default: Date.now },
    dateLivraison: Date
});
const Colis = mongoose.model('Colis', colisSchema);

const investisseurSchema = new mongoose.Schema({
    nom: String,
    adresse: String,
    email: String,
    telephone1: String,
    telephone2: String,
    pourcentage: Number,
    dureeMois: { type: Number, default: 12 },
    dateDebut: { type: Date, default: Date.now }
});
const Investisseur = mongoose.model('Investisseur', investisseurSchema);

const notificationSchema = new mongoose.Schema({
    message: String,
    type: { type: String, enum: ['info', 'success', 'error'], default: 'info' },
    date: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

const clientSchema = new mongoose.Schema({
    nom: { type: String, required: true },
    email: { type: String, required: true },
    telephone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    notifications: [{
        date: Date,
        message: String,
        type: String,
        image: String,
        lu: Boolean
    }],
    colisStatusCache: { type: Map, of: String, default: {} }
});
const Client = mongoose.model('Client', clientSchema);

const officeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, default: "" },
    type: { type: String, enum: ['principal', 'envoi', 'livraison', 'autre'], default: 'autre' },
    order: { type: Number, default: 0 }
});
const Office = mongoose.model('Office', officeSchema);

const publicContentSchema = new mongoose.Schema({
    carouselImages: { type: [String], default: [] },
    services: [{
        title: String,
        description: String,
        icon: String
    }],
    contact: {
        phone: { type: String, default: "+509 4114-1321" },
        email: { type: String, default: "expediplusshipping@gmail.com" },
        whatsapp: { type: String, default: "+509 4114-1321" },
        hours: { type: String, default: "Lun-Ven 8h-18h, Sam 9h-14h" }
    },
    bannerMessage: { type: String, default: "📢 Expedip+ Shipping : Livraison express & multi-services – Contactez +509 4114-1321" }
});
const PublicContent = mongoose.model('PublicContent', publicContentSchema);

// ---------- MIDDLEWARE AUTH CLIENT ----------
const authClient = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token manquant' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const client = await Client.findById(decoded.id);
        if (!client) return res.status(401).json({ error: 'Client introuvable' });
        req.client = client;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token invalide' });
    }
};

// ---------- ROUTES ----------
// Company
app.get('/api/company', async (req, res) => {
    let company = await Company.findOne();
    if (!company) company = await Company.create({});
    res.json(company);
});
app.put('/api/company', async (req, res) => {
    let company = await Company.findOne();
    if (!company) company = new Company();
    Object.assign(company, req.body);
    await company.save();
    res.json(company);
});

// Users
app.get('/api/users', async (req, res) => {
    const users = await User.find();
    res.json(users.map(u => ({ ...u._doc, password: undefined })));
});
app.post('/api/users', async (req, res) => {
    const { password, ...rest } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ ...rest, password: hashedPassword });
    await user.save();
    res.status(201).json({ ...user._doc, password: undefined });
});
app.put('/api/users/:id/password', async (req, res) => {
    const { password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });
    res.json({ success: true });
});
app.delete('/api/users/:id', async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.status(204).send();
});

// Colis
app.get('/api/colis', async (req, res) => {
    const { bureauLivreurId, bureauEnvoiId, statut, pourLivreur, telephoneClient } = req.query;
    let filter = {};
    if (bureauLivreurId) filter.bureauLivreurId = bureauLivreurId;
    if (bureauEnvoiId) filter.bureauEnvoiId = bureauEnvoiId;
    if (statut) filter.statut = statut;
    if (pourLivreur === 'true') {
        const company = await Company.findOne();
        if (company && company.superviseurActif === true) {
            filter.confirme = true;
            filter.statut = { $in: ['En transit', 'Arrivé'] };
        } else {
            filter.statut = { $in: ['En attente', 'En transit', 'Arrivé'] };
        }
    }
    if (telephoneClient) {
        filter['destinataire.telephone'] = telephoneClient;
        filter.statut = 'Arrivé';
    }
    const colis = await Colis.find(filter).sort({ dateEnvoi: -1 });
    res.json(colis);
});

app.post('/api/colis', async (req, res) => {
    try {
        const company = await Company.findOne();
        if (company && company.superviseurActif === false) {
            req.body.confirme = true;
            req.body.statut = 'En transit';
        }
        const colis = new Colis(req.body);
        await colis.save();
        if (colis.destinataire && colis.destinataire.telephone) {
            const client = await Client.findOne({ telephone: colis.destinataire.telephone });
            if (client) {
                client.notifications.unshift({
                    date: new Date(),
                    message: `📦 Nouveau colis enregistré pour vous: ${colis.numeroSuivi}. Il sera visible dès son arrivée au bureau.`,
                    type: 'info',
                    lu: false
                });
                if (client.notifications.length > 50) client.notifications.pop();
                await client.save();
            }
        }
        res.status(201).json(colis);
    } catch (err) {
        console.error('Erreur création colis:', err);
        res.status(500).json({ error: 'Erreur lors de la création du colis: ' + err.message });
    }
});

app.put('/api/colis/:id', async (req, res) => {
    const colis = await Colis.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (colis.statut === 'Arrivé' && colis.destinataire.telephone) {
        const client = await Client.findOne({ telephone: colis.destinataire.telephone });
        if (client) {
            client.notifications.unshift({
                date: new Date(),
                message: `🎉 Votre colis ${colis.numeroSuivi} est arrivé au bureau! Vous pouvez maintenant le voir dans votre espace client.`,
                type: 'success',
                lu: false
            });
            if (client.notifications.length > 50) client.notifications.pop();
            await client.save();
        }
    }
    if (colis.statut === 'Livré' && colis.destinataire.telephone) {
        const client = await Client.findOne({ telephone: colis.destinataire.telephone });
        if (client) {
            client.notifications.unshift({
                date: new Date(),
                message: `✅ Votre colis ${colis.numeroSuivi} a été livré avec succès! Merci.`,
                type: 'success',
                lu: false
            });
            if (client.notifications.length > 50) client.notifications.pop();
            await client.save();
        }
    }
    res.json(colis);
});

// Investisseurs
app.get('/api/investisseurs', async (req, res) => {
    const investisseurs = await Investisseur.find();
    res.json(investisseurs);
});
app.post('/api/investisseurs', async (req, res) => {
    const inv = new Investisseur(req.body);
    await inv.save();
    res.status(201).json(inv);
});
app.delete('/api/investisseurs/:id', async (req, res) => {
    await Investisseur.findByIdAndDelete(req.params.id);
    res.status(204).send();
});

// Notifications globales
app.get('/api/notifications', async (req, res) => {
    const notifs = await Notification.find().sort({ date: -1 }).limit(50);
    res.json(notifs);
});
app.post('/api/notifications', async (req, res) => {
    const notif = new Notification(req.body);
    await notif.save();
    res.status(201).json(notif);
});

// Auth employé
app.post('/api/auth/login', async (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
        return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
    }
    try {
        let user;
        if (identifier.includes('@')) {
            user = await User.findOne({ email: identifier });
        } else {
            user = await User.findOne({ code: identifier });
        }
        if (!user) return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
        res.json({ ...user._doc, password: undefined });
    } catch (err) {
        console.error('Erreur login:', err);
        return res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// ---------- ROUTES CONTENU PUBLIC ----------
app.get('/api/public-content', async (req, res) => {
    let content = await PublicContent.findOne();
    if (!content) {
        content = new PublicContent({
            carouselImages: [],
            services: [
                { title: "Colis & fret", description: "Expédition par avion/maritime, dédouanement.", icon: "fas fa-boxes" },
                { title: "Multi-services", description: "Paiement Moncash/Natcash, transfert d'argent.", icon: "fas fa-hand-holding-usd" },
                { title: "Livraison dernière minute", description: "Porte-à-porte dans toute la région métropolitaine.", icon: "fas fa-truck" }
            ],
            contact: { phone: "+509 4114-1321", email: "expediplusshipping@gmail.com", whatsapp: "+509 4114-1321", hours: "Lun-Ven 8h-18h, Sam 9h-14h" },
            bannerMessage: "📢 Expedip+ Shipping : Livraison express & multi-services – Contactez +509 4114-1321"
        });
        await content.save();
    }
    res.json(content);
});

app.put('/api/public-content', async (req, res) => {
    let content = await PublicContent.findOne();
    if (!content) content = new PublicContent();
    Object.assign(content, req.body);
    await content.save();
    res.json(content);
});

// ---------- ROUTES BUREAUX (AGENCES) ----------
app.get('/api/offices', async (req, res) => {
    const offices = await Office.find().sort({ order: 1 });
    res.json(offices);
});
app.post('/api/offices', async (req, res) => {
    const office = new Office(req.body);
    await office.save();
    res.status(201).json(office);
});
app.put('/api/offices/:id', async (req, res) => {
    const office = await Office.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(office);
});
app.delete('/api/offices/:id', async (req, res) => {
    await Office.findByIdAndDelete(req.params.id);
    res.status(204).send();
});

// ---------- ROUTES CLIENT ----------
app.post('/api/clients/register', async (req, res) => {
    const { nom, email, telephone, password } = req.body;
    const existing = await Client.findOne({ telephone });
    if (existing) return res.status(400).json({ error: 'Ce numéro est déjà utilisé' });
    const hashed = await bcrypt.hash(password, 10);
    const client = new Client({ nom, email, telephone, password: hashed, balance: 0, notifications: [] });
    await client.save();
    const token = jwt.sign({ id: client._id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, client: { id: client._id, nom, email, telephone, balance: 0 } });
});

app.post('/api/clients/login', async (req, res) => {
    const { telephone, password } = req.body;
    const client = await Client.findOne({ telephone });
    if (!client) return res.status(401).json({ error: 'Téléphone ou mot de passe incorrect' });
    const valid = await bcrypt.compare(password, client.password);
    if (!valid) return res.status(401).json({ error: 'Téléphone ou mot de passe incorrect' });
    const token = jwt.sign({ id: client._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, client: { id: client._id, nom: client.nom, email: client.email, telephone: client.telephone, balance: client.balance } });
});

app.get('/api/clients/me', authClient, async (req, res) => {
    res.json({ client: req.client });
});

app.post('/api/clients/recharge', authClient, async (req, res) => {
    const { amount, method } = req.body;
    if (amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
    req.client.balance += amount;
    req.client.notifications.unshift({
        date: new Date(),
        message: `💸 Recharge de ${amount} USD via ${method}. Nouveau solde: ${req.client.balance} USD`,
        type: 'success',
        lu: false
    });
    if (req.client.notifications.length > 50) req.client.notifications.pop();
    await req.client.save();
    res.json({ balance: req.client.balance });
});

app.post('/api/clients/pay/:colisId', authClient, async (req, res) => {
    const colis = await Colis.findById(req.params.colisId);
    if (!colis) return res.status(404).json({ error: 'Colis introuvable' });
    if (colis.paiement?.effectue) return res.status(400).json({ error: 'Colis déjà payé' });
    if (colis.destinataire.telephone !== req.client.telephone) return res.status(403).json({ error: 'Ce colis ne vous appartient pas' });
    if (req.client.balance < colis.prixUsd) return res.status(400).json({ error: 'Solde insuffisant' });
    req.client.balance -= colis.prixUsd;
    colis.paiement = {
        effectue: true,
        montantRecu: colis.prixUsd,
        devise: 'USD',
        moyen: 'Portefeuille client',
        photoCNI: null,
        photoColisLivraison: null
    };
    await colis.save();
    req.client.notifications.unshift({
        date: new Date(),
        message: `✅ Paiement de ${colis.prixUsd} USD pour le colis ${colis.numeroSuivi} effectué.`,
        type: 'success',
        lu: false
    });
    await req.client.save();
    res.json({ success: true, balance: req.client.balance, colis });
});

app.get('/api/clients/colis', authClient, async (req, res) => {
    const colis = await Colis.find({ 
        'destinataire.telephone': req.client.telephone,
        statut: 'Arrivé'
    }).sort({ dateEnvoi: -1 });
    res.json(colis);
});

app.get('/api/clients/notifications', authClient, async (req, res) => {
    res.json(req.client.notifications || []);
});

app.delete('/api/clients/notifications', authClient, async (req, res) => {
    req.client.notifications = [];
    await req.client.save();
    res.json({ success: true });
});

// ---------- MIGRATION DES MOTS DE PASSE ----------
// Tourne en arrière-plan, ne bloque jamais le login
async function upgradePasswords() {
    try {
        const users = await User.find({});
        let modified = 0;
        for (const user of users) {
            if (!user.password || !user.password.startsWith('$2b$')) {
                const newPassword = user.code || 'default123';
                const hashed = await bcrypt.hash(newPassword, 10);
                await User.findByIdAndUpdate(user._id, { password: hashed });
                modified++;
                console.log(`  ✅ Mot de passe migré pour ${user.nom}`);
            }
        }
        console.log(modified > 0 ? `✅ ${modified} mot(s) de passe migrés.` : '✅ Tous les mots de passe sont déjà hachés.');
    } catch (err) {
        console.error('❌ Erreur migration mots de passe:', err);
    }
}

// ---------- CONNEXION MONGODB ----------
const MONGODB_URI = process.env.MONGODB_URL || 'mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/shiplog?retryWrites=true&w=majority';
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        console.log('✅ Connecté à MongoDB Atlas');
        
        // Migration des mots de passe pour tous les utilisateurs
        await upgradePasswords();

        const userCount = await User.countDocuments();
        if (userCount === 0) {
            const defaultUsers = [
                { nom: 'Alice Receveur', bureauNom: 'Bureau Port-au-Prince', adresse: '123, Rue Capois', role: 'receveur', code: '1234', password: '1234', email: 'alice@shiplog.com' },
                { nom: 'Bob Livreur', bureauNom: 'Bureau Miami', adresse: '456 Biscayne Blvd', role: 'livreur', code: '5678', password: '5678', email: 'bob@shiplog.com' },
                { nom: 'Superviseur Central', bureauNom: 'Supervision', adresse: 'Siège', role: 'superviseur', code: '9999', password: '9999', email: 'sup@shiplog.com' },
                { nom: 'Admin Système', bureauNom: 'Siège', adresse: '1 Avenue Centrale', role: 'admin', code: 'admin123', password: 'admin123', email: 'admin@shiplog.com' }
            ];
            for (const u of defaultUsers) {
                const hashed = await bcrypt.hash(u.password, 10);
                await User.create({ ...u, password: hashed });
            }
            await Company.create({ name: "Ship'Log Express", tauxUSDToHTG: 130, prixParLivre: 2.5, fraisFixe: 5, superviseurActif: true });
            await Investisseur.create({ 
                nom: 'Jean Dupont', adresse: '10 Rue des Actionnaires', email: 'jean@example.com', 
                telephone1: '123456789', pourcentage: 15, dureeMois: 24, dateDebut: new Date() 
            });
            console.log('📦 Données initiales créées');
        }

        // Initialisation du contenu public
        await PublicContent.findOne() || await PublicContent.create({});
        // Initialisation d'un bureau par défaut si aucun
        const officeCount = await Office.countDocuments();
        if (officeCount === 0) {
            await Office.create([
                { name: "Bureau Principal (Pétion-Ville)", address: "Angle rue Métellus, Immeuble ExpediPlus", phone: "+509 4114-1321", type: "principal", order: 1 },
                { name: "Entrepôt – Croix-des-Bouquets", address: "Zone industrielle, Route Nationale #1", type: "livraison", order: 2 },
                { name: "Antenne des Gonaïves", address: "Rue Charlemagne, près du marché public", type: "envoi", order: 3 }
            ]);
            console.log('📦 Bureaux par défaut créés');
        }

        // Démarrer le serveur
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log(`🚀 Serveur prêt sur le port ${PORT}`));
    })
    .catch(err => {
        console.error('❌ Erreur MongoDB:', err);
        process.exit(1);
    });