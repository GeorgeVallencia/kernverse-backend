const mongoose = require('mongoose');

const { Schema, model } = mongoose;
const BlogSchema = new Schema({
  title: String,
  story: String,
  cover: String,
  author: { type:Schema.Types.ObjectId, ref:'User' },
  clapCount: { type: Number, default: 0 }, // Initialize clapCount to 0
  comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comments' }], // Reference to Comment

}, {
  timestamps: true,
});

const BlogModel = model('blog', BlogSchema);

module.exports = BlogModel;