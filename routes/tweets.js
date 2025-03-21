
const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Tweet = require('../models/Tweet');
const User = require('../models/User');
const mongoose = require('mongoose');

// @route   POST /api/tweets
// @desc    Create a tweet
// @access  Private
router.post(
  '/',
  [
    auth,
    check('content', 'Content is required').not().isEmpty().isLength({ max: 280 })
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    try {
      const { content, image, replyToId } = req.body;

      // Create new tweet
      const newTweet = new Tweet({
        content,
        user: req.user.id,
        image: image || ''
      });

      // If it's a reply, add replyTo field
      if (replyToId) {
        const originalTweet = await Tweet.findById(replyToId);
        if (!originalTweet) {
          return res.status(404).json({
            success: false,
            message: 'Tweet to reply to not found'
          });
        }
        newTweet.replyTo = replyToId;
      }

      const tweet = await newTweet.save();
      
      // Populate user info
      await tweet.populate('user', 'name username profileImage');
      
      if (tweet.replyTo) {
        await tweet.populate({
          path: 'replyTo',
          populate: { path: 'user', select: 'username' }
        });
      }

      res.status(201).json({
        success: true,
        tweet
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @route   GET /api/tweets
// @desc    Get tweets (timeline, user tweets, search)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { username, query, type, replyToId, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    let matchCriteria = {};
    
    // Filter by username
    if (username) {
      const user = await User.findOne({ username });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      matchCriteria.user = user._id;
    }
    
    // Filter by search query
    if (query) {
      matchCriteria.content = { $regex: query, $options: 'i' };
    }
    
    // Filter by tweet type
    if (type) {
      switch (type) {
        case 'replies':
          // Include only tweets and replies
          break;
        case 'media':
          matchCriteria.image = { $ne: '' };
          break;
        case 'likes':
          if (username) {
            const user = await User.findOne({ username });
            if (!user) {
              return res.status(404).json({
                success: false,
                message: 'User not found'
              });
            }
            // Get tweets liked by user
            const likedTweets = await Tweet.find({ _id: { $in: user.likes } })
              .populate('user', 'name username profileImage')
              .populate({
                path: 'replyTo',
                populate: { path: 'user', select: 'username' }
              })
              .sort({ createdAt: -1 })
              .skip(skip)
              .limit(parseInt(limit));
            
            // Add isLiked and isRetweeted properties
            const tweetsWithUserInfo = await addUserInteractionInfo(likedTweets, req.user);
            
            return res.json({
              success: true,
              tweets: tweetsWithUserInfo
            });
          }
          break;
        default:
          // Default to normal tweets
          break;
      }
    }
    
    // Filter by replies to a specific tweet
    if (replyToId) {
      matchCriteria.replyTo = replyToId;
    } else if (!type || type === 'tweets') {
      // For regular timeline, exclude replies unless specifically requested
      matchCriteria.replyTo = { $exists: false };
    }
    
    // Get tweets based on criteria
    let tweets;
    
    if (!username && !query && !replyToId && (!type || type === 'tweets')) {
      // For home timeline, get tweets from users that the current user follows
      const followingIds = req.user.following;
      followingIds.push(req.user._id); // Include user's own tweets
      
      tweets = await Tweet.find({ 
        user: { $in: followingIds },
        replyTo: { $exists: false }
      })
        .populate('user', 'name username profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
    } else {
      // For other queries
      tweets = await Tweet.find(matchCriteria)
        .populate('user', 'name username profileImage')
        .populate({
          path: 'replyTo',
          populate: { path: 'user', select: 'username' }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
    }
    
    // Add isLiked and isRetweeted properties
    const tweetsWithUserInfo = await addUserInteractionInfo(tweets, req.user);
    
    res.json({
      success: true,
      tweets: tweetsWithUserInfo
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/tweets/:id
// @desc    Get a tweet by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const tweet = await Tweet.findById(req.params.id)
      .populate('user', 'name username profileImage')
      .populate({
        path: 'replyTo',
        populate: { path: 'user', select: 'name username profileImage' }
      });
    
    if (!tweet) {
      return res.status(404).json({
        success: false,
        message: 'Tweet not found'
      });
    }
    
    // Get reply/retweet/like counts
    const commentsCount = await Tweet.countDocuments({ replyTo: tweet._id });
    const likesCount = tweet.likes.length;
    const retweetsCount = tweet.retweets.length;
    
    // Check if user has liked or retweeted
    const isLiked = tweet.likes.includes(req.user.id);
    const isRetweeted = tweet.retweets.includes(req.user.id);
    
    // If it's a reply, add replyToUser info
    let replyToUser = null;
    if (tweet.replyTo) {
      replyToUser = {
        _id: tweet.replyTo.user._id,
        name: tweet.replyTo.user.name,
        username: tweet.replyTo.user.username
      };
    }
    
    res.json({
      success: true,
      tweet: {
        ...tweet.toJSON(),
        commentsCount,
        likesCount,
        retweetsCount,
        isLiked,
        isRetweeted,
        replyToUser
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/tweets/:id
// @desc    Delete a tweet
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const tweet = await Tweet.findById(req.params.id);
    
    if (!tweet) {
      return res.status(404).json({
        success: false,
        message: 'Tweet not found'
      });
    }
    
    // Check if tweet belongs to user
    if (tweet.user.toString() !== req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'User not authorized'
      });
    }
    
    await tweet.deleteOne();
    
    res.json({
      success: true,
      message: 'Tweet removed'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/tweets/:id/like
// @desc    Like a tweet
// @access  Private
router.post('/:id/like', auth, async (req, res) => {
  try {
    const tweet = await Tweet.findById(req.params.id);
    
    if (!tweet) {
      return res.status(404).json({
        success: false,
        message: 'Tweet not found'
      });
    }
    
    // Check if tweet has already been liked
    if (tweet.likes.includes(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Tweet already liked'
      });
    }
    
    // Add user to tweet likes
    tweet.likes.unshift(req.user.id);
    await tweet.save();
    
    // Add tweet to user likes
    await User.findByIdAndUpdate(req.user.id, {
      $push: { likes: tweet._id }
    });
    
    res.json({
      success: true,
      message: 'Tweet liked'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/tweets/:id/unlike
// @desc    Unlike a tweet
// @access  Private
router.post('/:id/unlike', auth, async (req, res) => {
  try {
    const tweet = await Tweet.findById(req.params.id);
    
    if (!tweet) {
      return res.status(404).json({
        success: false,
        message: 'Tweet not found'
      });
    }
    
    // Check if tweet has not been liked
    if (!tweet.likes.includes(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Tweet has not been liked'
      });
    }
    
    // Remove user from tweet likes
    tweet.likes = tweet.likes.filter(
      like => like.toString() !== req.user.id
    );
    await tweet.save();
    
    // Remove tweet from user likes
    await User.findByIdAndUpdate(req.user.id, {
      $pull: { likes: tweet._id }
    });
    
    res.json({
      success: true,
      message: 'Tweet unliked'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/tweets/:id/retweet
// @desc    Retweet a tweet
// @access  Private
router.post('/:id/retweet', auth, async (req, res) => {
  try {
    const tweet = await Tweet.findById(req.params.id);
    
    if (!tweet) {
      return res.status(404).json({
        success: false,
        message: 'Tweet not found'
      });
    }
    
    // Check if tweet has already been retweeted by user
    if (tweet.retweets.includes(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Tweet already retweeted'
      });
    }
    
    // Add user to tweet retweets
    tweet.retweets.unshift(req.user.id);
    await tweet.save();
    
    // Add tweet to user retweets
    await User.findByIdAndUpdate(req.user.id, {
      $push: { retweets: tweet._id }
    });
    
    res.json({
      success: true,
      message: 'Tweet retweeted'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/tweets/:id/unretweet
// @desc    Unretweet a tweet
// @access  Private
router.post('/:id/unretweet', auth, async (req, res) => {
  try {
    const tweet = await Tweet.findById(req.params.id);
    
    if (!tweet) {
      return res.status(404).json({
        success: false,
        message: 'Tweet not found'
      });
    }
    
    // Check if tweet has not been retweeted
    if (!tweet.retweets.includes(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Tweet has not been retweeted'
      });
    }
    
    // Remove user from tweet retweets
    tweet.retweets = tweet.retweets.filter(
      retweet => retweet.toString() !== req.user.id
    );
    await tweet.save();
    
    // Remove tweet from user retweets
    await User.findByIdAndUpdate(req.user.id, {
      $pull: { retweets: tweet._id }
    });
    
    res.json({
      success: true,
      message: 'Tweet unretweeted'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Helper function to add user interaction info to tweets
async function addUserInteractionInfo(tweets, user) {
  return Promise.all(tweets.map(async tweet => {
    const tweetObj = tweet.toJSON ? tweet.toJSON() : tweet;
    
    // Check if user has liked the tweet
    const isLiked = tweet.likes.includes(user._id);
    
    // Check if user has retweeted the tweet
    const isRetweeted = tweet.retweets.includes(user._id);
    
    // Get counts
    const commentsCount = await Tweet.countDocuments({ replyTo: tweet._id });
    
    // Add replyToUser if it's a reply
    let replyToUser = null;
    if (tweet.replyTo) {
      replyToUser = {
        _id: tweet.replyTo.user._id,
        name: tweet.replyTo.user.name,
        username: tweet.replyTo.user.username
      };
    }
    
    return {
      ...tweetObj,
      isLiked,
      isRetweeted,
      likesCount: tweet.likes.length,
      retweetsCount: tweet.retweets.length,
      commentsCount,
      replyToUser
    };
  }));
}

module.exports = router;
