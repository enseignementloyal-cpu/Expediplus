require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.')); // sert le fichier index.html à la racine

// ---------- MODÈLES ----------
const companySchema = new mongoose.Schema({
  name: { type: String, default: "Ship'Log Express" },
  logo: { type: String, default: "" },
  tauxUSDToHTG: { type: Number, default: 130 },
  prixParLivre: { type: Number, default: 2.5 },
  fraisFixe: { type: Number, default: 5 }
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
  pourcentage: Number
});
const Investisseur = mongoose.model('Investisseur', investisseurSchema);

const notificationSchema = new mongoose.Schema({
  message: String,
  type: { type: String, enum: ['info', 'success', 'error'], default: 'info' },
  date: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

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

// Colis
app.get('/api/colis', async (req, res) => {
  const { bureauLivreurId, bureauEnvoiId, confirme, statut } = req.query;
  let filter = {};
  if (bureauLivreurId) filter.bureauLivreurId = bureauLivreurId;
  if (bureauEnvoiId) filter.bureauEnvoiId = bureauEnvoiId;
  if (confirme !== undefined) filter.confirme = confirme === 'true';
  if (statut) filter.statut = statut;
  const colis = await Colis.find(filter).sort({ dateEnvoi: -1 });
  res.json(colis);
});
app.post('/api/colis', async (req, res) => {
  const colis = new Colis(req.body);
  await colis.save();
  res.status(201).json(colis);
});
app.put('/api/colis/:id', async (req, res) => {
  const colis = await Colis.findByIdAndUpdate(req.params.id, req.body, { new: true });
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

// Notifications
app.get('/api/notifications', async (req, res) => {
  const notifs = await Notification.find().sort({ date: -1 }).limit(50);
  res.json(notifs);
});
app.post('/api/notifications', async (req, res) => {
  const notif = new Notification(req.body);
  await notif.save();
  res.status(201).json(notif);
});

// Auth
app.post('/api/auth/login', async (req, res) => {
  const { code } = req.body;
  const user = await User.findOne({ code });
  if (!user) return res.status(401).json({ error: 'Code invalide' });
  res.json(user);
});

// ---------- CONNEXION MONGODB ATLAS ----------
const MONGODB_URI = process.env.MONGODB_URL || 'mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/shiplog?retryWrites=true&w=majority';
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ Connecté à MongoDB Atlas');
    // Création de données initiales si vide
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      await User.create([
        { nom: 'Alice Receveur', bureauNom: 'Bureau Port-au-Prince', adresse: '123, Rue Capois', role: 'receveur', code: '1234', email: 'alice@shiplog.com' },
        { nom: 'Bob Livreur', bureauNom: 'Bureau Miami', adresse: '456 Biscayne Blvd', role: 'livreur', code: '5678', email: 'bob@shiplog.com' },
        { nom: 'Superviseur Central', bureauNom: 'Supervision', adresse: 'Siège', role: 'superviseur', code: '9999', email: 'sup@shiplog.com' },
        { nom: 'Admin Système', bureauNom: 'Siège', adresse: '1 Avenue Centrale', role: 'admin', code: 'admin123', email: 'admin@shiplog.com' }
      ]);
      await Company.create({ name: "Ship'Log Express", tauxUSDToHTG: 130, prixParLivre: 2.5, fraisFixe: 5 });
      await Investisseur.create({ nom: 'Jean Dupont', adresse: '10 Rue des Actionnaires', email: 'jean@example.com', telephone1: '123456789', pourcentage: 15 });
      console.log('📦 Données initiales créées');
    }
  })
  .catch(err => console.error('❌ Erreur MongoDB:', err));

// ---------- DÉMARRAGE ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serveur prêt sur le port ${PORT}`));