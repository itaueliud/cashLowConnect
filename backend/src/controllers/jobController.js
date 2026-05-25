const axios = require('axios');
const Job = require('../models/Job');
const Transaction = require('../models/Transaction');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { JOB_APPLICATION_TOKEN_TIERS, TOKEN_PACKAGES, JOB_POSTING_TOKEN_COST, getApplicationTokenCost } = require('../config/monetization');
const DEFAULT_JOB_CATEGORIES = [
  'Software Development',
  'Product Management',
  'Data Science',
  'DevOps & Cloud',
  'Design',
  'Marketing',
  'Customer Support',
  'Writing',
  'Data Entry',
  'Virtual Assistance',
  'Finance',
  'Sales',
  'Human Resources',
  'Legal',
  'Operations',
  'Cybersecurity',
  'QA & Testing',
  'Business Analysis',
  'Project Management',
  'Other',
];

// @GET /api/jobs
exports.getJobs = async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const now = new Date();

    const query = {
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    };
    if (category) query.category = category;
    if (search) query.$text = { $search: search };

    const [jobs, total] = await Promise.all([
      Job.find(query).sort({ publishedAt: -1 }).skip(skip).limit(Number(limit)),
      Job.countDocuments(query),
    ]);

    res.json({
      success: true,
      jobs,
      tokenPolicy: {
        applicationTiers: JOB_APPLICATION_TOKEN_TIERS,
        tokenPackages: TOKEN_PACKAGES,
        postingCost: JOB_POSTING_TOKEN_COST,
      },
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error(`getJobs error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @POST /api/jobs
exports.createJobPosting = async (req, res) => {
  try {
    const user = req.user;
    if (!user.activationStatus) {
      return res.status(403).json({ success: false, message: 'Activation required to post jobs' });
    }

    if ((user.tokenBalance || 0) < JOB_POSTING_TOKEN_COST) {
      return res.status(400).json({
        success: false,
        message: `Posting one job requires ${JOB_POSTING_TOKEN_COST} tokens`,
        tokenBalance: user.tokenBalance || 0,
      });
    }

    const {
      title,
      company,
      category,
      categoryOther,
      jobType,
      location,
      salary,
      description,
      applicationUrl,
      tags = [],
      budgetAmount,
      budgetCurrency = 'KES',
    } = req.body;

    if (!title || !company || !category || !description || !applicationUrl) {
      return res.status(400).json({ success: false, message: 'Missing required job posting fields' });
    }

    const normalizedCategory = String(category || '').trim();
    let normalizedCategoryOther = null;
    if (normalizedCategory === 'Other') {
      normalizedCategoryOther = String(categoryOther || '').trim();
      if (normalizedCategoryOther.length < 3 || normalizedCategoryOther.length > 60) {
        return res.status(400).json({
          success: false,
          message: 'Please specify Other category using 3 to 60 characters',
        });
      }
    }

    const normalizedBudget = Number(budgetAmount) || 0;
    const applicationTokenCost = getApplicationTokenCost(normalizedBudget);
    const publishedAt = new Date();
    user.consumeTokens(JOB_POSTING_TOKEN_COST);
    await user.save();

    const job = await Job.create({
      externalId: `internal-${Date.now()}-${user.userId}`,
      source: 'internal',
      title,
      company,
      category: normalizedCategory,
      categoryOther: normalizedCategoryOther,
      jobType: jobType || 'contract',
      location: location || 'Remote',
      salary: salary || null,
      description,
      tags,
      applicationUrl,
      postedBy: user._id,
      budgetAmount: normalizedBudget || null,
      budgetCurrency,
      postingTokenCost: JOB_POSTING_TOKEN_COST,
      applicationTokenCost,
      publishedAt,
      expiresAt: null,
      isActive: true,
    });

    await Transaction.create({
      userId: user._id,
      type: 'job_posting',
      amountLocal: JOB_POSTING_TOKEN_COST,
      amountUSD: 0,
      currency: 'TOKEN',
      country: user.country,
      provider: 'internal',
      direction: 'debit',
      status: 'successful',
      processedAt: new Date(),
      metadata: {
        jobId: job._id.toString(),
        tokensSpent: JOB_POSTING_TOKEN_COST,
      },
    });

    res.status(201).json({
      success: true,
      job,
      tokenBalance: user.tokenBalance,
      tokensSpent: JOB_POSTING_TOKEN_COST,
    });
  } catch (error) {
    logger.error(`createJobPosting error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @GET /api/jobs/categories
exports.getCategories = async (req, res) => {
  try {
    const now = new Date();
    const categories = await Job.distinct('category', {
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });
    const normalized = (categories || []).filter(Boolean);
    const merged = [...new Set([...DEFAULT_JOB_CATEGORIES, ...normalized])];
    return res.json({ success: true, categories: merged });
  } catch (error) {
    logger.error(`getCategories error: ${error.message}`);
    return res.json({
      success: true,
      categories: DEFAULT_JOB_CATEGORIES,
      fallback: true,
    });
  }
};

// @GET /api/jobs/:id
exports.getJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job || !job.isActive || (job.expiresAt && job.expiresAt <= new Date())) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }
    job.views += 1;
    await job.save();
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Called by cron scheduler every 6 hours
exports.syncJobs = async () => {
  logger.info('Syncing remote jobs...');
  let synced = 0;
  const remoteLimit = Math.min(Math.max(Number(process.env.JOBS_SYNC_LIMIT || 5000), 100), 20000);

  try {
    // Remotive
    const remotiveRes = await axios.get(process.env.REMOTIVE_API_URL || 'https://remotive.com/api/remote-jobs', {
      timeout: 10000,
    });
    const remotiveJobs = remotiveRes.data?.jobs || [];

    const remotiveOps = remotiveJobs.slice(0, remoteLimit).map((job) => ({
      updateOne: {
        filter: { externalId: `remotive-${job.id}` },
        update: {
          $set: {
            externalId: `remotive-${job.id}`,
            source: 'remotive',
            title: job.title,
            company: job.company_name,
            companyLogo: job.company_logo,
            category: job.category || 'Other',
            jobType: job.job_type || 'full-time',
            location: 'Remote',
            salary: job.salary || null,
            description: job.description?.slice(0, 2000) || '',
            tags: job.tags || [],
            applicationUrl: job.url,
            publishedAt: new Date(job.publication_date),
            isActive: true,
          },
        },
        upsert: true,
      },
    }));
    if (remotiveOps.length > 0) {
      await Job.bulkWrite(remotiveOps, { ordered: false });
      synced += remotiveOps.length;
    }

    // Jobicy
    const jobicyRes = await axios.get(process.env.JOBICY_API_URL || 'https://jobicy.com/api/v2/remote-jobs', {
      timeout: 10000,
    });
    const jobicyJobs = jobicyRes.data?.jobs || [];

    for (const job of jobicyJobs.slice(0, remoteLimit)) {
      await Job.findOneAndUpdate(
        { externalId: `jobicy-${job.id}` },
        {
          externalId: `jobicy-${job.id}`,
          source: 'jobicy',
          title: job.jobTitle,
          company: job.companyName,
          companyLogo: job.companyLogo || null,
          category: job.jobIndustry?.[0] || 'Other',
          jobType: job.jobType || 'full-time',
          location: 'Remote',
          salary: job.annualSalaryMin ? `$${job.annualSalaryMin} - $${job.annualSalaryMax}` : null,
          description: job.jobDescription?.slice(0, 2000) || '',
          tags: job.jobLevel ? [job.jobLevel] : [],
          applicationUrl: job.url,
          publishedAt: new Date(job.pubDate),
          isActive: true,
        },
        { upsert: true, new: true }
      );
      synced++;
    }

    // Jooble (optional, enabled when JOOBLE_API_KEY is configured)
    if (process.env.JOOBLE_API_KEY) {
      try {
        const joobleCountry = String(process.env.JOOBLE_COUNTRY || 'ke').toLowerCase();
        const joobleKeywords = process.env.JOOBLE_KEYWORDS || 'remote';
        const joobleLocation = process.env.JOOBLE_LOCATION || '';
        const joobleApiUrl = process.env.JOOBLE_API_URL || 'https://jooble.org/api';

        const joobleRes = await axios.post(
          `${joobleApiUrl.replace(/\/+$/, '')}/${process.env.JOOBLE_API_KEY}`,
          {
            keywords: joobleKeywords,
            location: joobleLocation,
            page: 1,
          },
          {
            timeout: 12000,
            headers: { 'Content-Type': 'application/json' },
          }
        );

        const joobleJobs = joobleRes.data?.jobs || [];
        for (const job of joobleJobs.slice(0, remoteLimit)) {
          const applicationUrl = job.link || job.url;
          if (!applicationUrl) continue;
          const externalId = job.id || job.link || `${job.title || 'job'}-${job.company || 'company'}`;
          await Job.findOneAndUpdate(
            { externalId: `jooble-${externalId}` },
            {
              externalId: `jooble-${externalId}`,
              source: 'jooble',
              title: job.title || 'Remote role',
              company: job.company || 'Unknown company',
              companyLogo: null,
              category: job.category || 'Other',
              jobType: job.type || 'full-time',
              location: job.location || 'Remote',
              salary: job.salary || null,
              description: (job.snippet || job.description || '').slice(0, 2000),
              tags: ['jooble', joobleCountry],
              applicationUrl,
              publishedAt: job.updated ? new Date(job.updated) : new Date(),
              isActive: true,
            },
            { upsert: true, new: true }
          );
          synced++;
        }
      } catch (joobleError) {
        logger.warn(`Jooble sync skipped: ${joobleError.message}`);
      }
    } else {
      logger.info('Jooble sync skipped: JOOBLE_API_KEY not configured');
    }

    // Hard-delete jobs older than 1 year.
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    await Job.deleteMany({ publishedAt: { $lt: oneYearAgo } });

    logger.info(`Job sync complete. Synced ${synced} jobs.`);
  } catch (error) {
    logger.error(`syncJobs error: ${error.message}`);
  }
};
