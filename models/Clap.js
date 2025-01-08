const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const ClapSchema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blogId: { type: mongoose.Schema.Types.ObjectId, ref: 'Blog', required: true },
  createdAt: { type: Date, default: Date.now },
},
{  timestamps: true,  }
);

const ClapModel = model('Clap', ClapSchema);

module.exports = ClapModel;