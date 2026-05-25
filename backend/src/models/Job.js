const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  externalId: { type: String, required: true, unique: true },
  source: { type: String, enum: ['remotive', 'jobicy', 'jooble', 'adzuna', 'internal'], required: true },
  title: { type: String, required: true },
  company: { type: String, required: true },
  companyLogo: { type: String, default: null },
  category: { type: String, required: true },
  categoryOther: { type: String, default: null },
  jobType: { type: String, default: 'full-time' },
  location: { type: String, default: 'Remote' },
  salary: { type: String, default: null },
  description: { type: String, required: true },
  tags: [{ type: String }],
  applicationUrl: { type: String, required: true },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  budgetAmount: { type: Number, default: null },
  budgetCurrency: { type: String, default: null },
  postingTokenCost: { type: Number, default: 0 },
  applicationTokenCost: { type: Number, default: 0 },
  expiresAt: { type: Date, default: null },
  publishedAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  views: { type: Number, default: 0 },
  saves: { type: Number, default: 0 },
}, {
  timestamps: true,
});

jobSchema.index({ category: 1 });
jobSchema.index({ publishedAt: -1 });
jobSchema.index({ isActive: 1 });
jobSchema.index({ expiresAt: 1 });
jobSchema.index({ title: 'text', company: 'text', description: 'text' });

module.exports = mongoose.model('Job', jobSchema);
