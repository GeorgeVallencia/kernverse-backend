const mongoose = require('mongoose');
const Blog = require('./Blogs'); // Make sure the path to your Blog model is correct


const { Schema, model } = mongoose;
const CommentsSchema = new Schema({
  comment: { type: String, required: true },
  blogId: { type: mongoose.Schema.Types.ObjectId, ref: 'Blog', required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
}, 
{ timestamps: true, }
);


// After saving a comment, increment the commentCount in the related Blog
CommentsSchema.post('save', async function () {
  await Blog.findByIdAndUpdate(this.blogId, { $inc: { commentCount: 1 } });
});

// Before deleting a comment, decrement the commentCount in the related Blog
CommentsSchema.pre('remove', async function () {
  await Blog.findByIdAndUpdate(this.blogId, { $inc: { commentCount: -1 } });
});

const   CommentsModel = model('Comments', CommentsSchema);


module.exports = CommentsModel;


//password =UhGN2vb7paQG2c03
// mongo uri = mongodb+srv://valencia:<db_password>@cluster4.wqcld.mongodb.net/?retryWrites=true&w=majority&appName=Cluster4
//MONGO_URI = mongodb+srv://valencia:UhGN2vb7paQG2c03@cluster4.wqcld.mongodb.net/dollar-blog?retryWrites=true&w=majority&appName=Cluster4