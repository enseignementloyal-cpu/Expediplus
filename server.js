require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

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
  code: { type: String, required: true, unique: true }
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
  res.json(users);
});
app.post('/api/users', async (req, res) => {
  const user = new User(req.body);
  await user.save();
  res.status(201).json(user);
});
app.delete('/api/users/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

// Colis - NOUVELLE LOGIQUE
app.get('/api/colis', async (req, res) => {
  const { bureauLivreurId, bureauEnvoiId, statut, pourLivreur, telephoneClient } = req.query;
  let filter = {};
  
  if (bureauLivreurId) filter.bureauLivreurId = bureauLivreurId;
  if (bureauEnvoiId) filter.bureauEnvoiId = bureauEnvoiId;
  if (statut) filter.statut = statut;
  
  // LOGIQUE POUR LIVREUR: voir colis selon superviseur actif ou non
  if (pourLivreur === 'true') {
    const company = await Company.findOne();
    if (company && company.superviseurActif === true) {
      filter.confirme = true;
      filter.statut = { $in: ['En transit', 'Arrivé'] };
    } else {
      filter.statut = { $in: ['En attente', 'En transit', 'Arrivé'] };
    }
  }
  
  // Pour les clients: ne voir que les colis ARRIVÉS
  if (telephoneClient) {
    filter['destinataire.telephone'] = telephoneClient;
    filter.statut = 'Arrivé';
  }
  
  const colis = await Colis.find(filter).sort({ dateEnvoi: -1 });
  res.json(colis);
});

app.post('/api/colis', async (req, res) => {
  const company = await Company.findOne();
  if (company && company.superviseurActif === false) {
    req.body.confirme = true;
    req.body.statut = 'En transit';
  }
  const colis = new Colis(req.body);
  await colis.save();
  
  if (colis.destinataire.telephone) {
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
  const { code } = req.body;
  const user = await User.findOne({ code });
  if (!user) return res.status(401).json({ error: 'Code invalide' });
  res.json(user);
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

// Liste des colis du client - UNIQUEMENT ceux arrivés
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

// ---------- CONNEXION MONGODB ----------
const MONGODB_URI = process.env.MONGODB_URL || 'mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/shiplog?retryWrites=true&w=majority';
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ Connecté à MongoDB Atlas');
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      await User.create([
        { nom: 'Alice Receveur', bureauNom: 'Bureau Port-au-Prince', adresse: '123, Rue Capois', role: 'receveur', code: '1234', email: 'alice@shiplog.com' },
        { nom: 'Bob Livreur', bureauNom: 'Bureau Miami', adresse: '456 Biscayne Blvd', role: 'livreur', code: '5678', email: 'bob@shiplog.com' },
        { nom: 'Superviseur Central', bureauNom: 'Supervision', adresse: 'Siège', role: 'superviseur', code: '9999', email: 'sup@shiplog.com' },
        { nom: 'Admin Système', bureauNom: 'Siège', adresse: '1 Avenue Centrale', role: 'admin', code: 'admin123', email: 'admin@shiplog.com' }
      ]);
      await Company.create({ name: "Ship'Log Express", tauxUSDToHTG: 130, prixParLivre: 2.5, fraisFixe: 5, superviseurActif: true });
      await Investisseur.create({ 
        nom: 'Jean Dupont', adresse: '10 Rue des Actionnaires', email: 'jean@example.com', 
        telephone1: '123456789', pourcentage: 15, dureeMois: 24, dateDebut: new Date() 
      });
      console.log('📦 Données initiales créées');
    }
  })
  .catch(err => console.error('❌ Erreur MongoDB:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serveur prêt sur le port ${PORT}`));